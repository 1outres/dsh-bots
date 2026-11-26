import { posix } from "node:path"
import type { BotSessionKind, BotSkillEntry, SkillToolRequest } from "../../internal"
import type { InvalidSkill } from "../../shared/skills"
import { type KindAgent, type SessionKindDeps, sessionKindOf } from "../prompt/session-kind"
import { createSkillLibrary, type SkillCatalog, type SkillsPlace } from "./library"
import {
  type BotSkillsState,
  changes,
  createSkillManager,
  parseSkillArgs,
  type SkillActor,
  type SkillManageArgs,
  type SkillManagerDeps,
  SkillToolError,
  type SweptSkill,
} from "./manage"
import type { ReviewSessions } from "./review"
import { parseSkill, SKILL_FILE, skillDirectory } from "./skill"
import type { SkillStore } from "./store"

export interface BotSkillsDeps<A extends KindAgent> {
  sealed(botId: string, token: string): boolean
  agent(agentId: string): A | undefined
  botOf(agent: A): string | undefined
  kind: SessionKindDeps
  reviews: Pick<ReviewSessions, "get">
  placeOf(botId: string, token: string): SkillsPlace | undefined
  history: Omit<SkillManagerDeps, "changed">
  store: Pick<SkillStore, "recordUse">
  stepped(botId: string, sessionId: string): void
  peerTurn(agentId: string): boolean
  shield<T>(botId: string, value: T): Promise<T>
  now(): number
  warn(message: string): void
}

const MANAGING_SESSIONS: readonly BotSessionKind[] = ["main", "web", "curator"]

export const PEER_TURN_REFUSAL =
  "skill_manage changes skills only in turns with your owner; this turn took in a message from a peer bot, so only list and view work here. Tell your owner if a skill should change"

export interface SkillsReading {
  readonly active: readonly { readonly name: string; readonly description: string }[]
  readonly archived: readonly { readonly name: string; readonly description: string }[]
  readonly invalid: readonly InvalidSkill[]
}

export interface BotSkills {
  available(botId: string, token: string, agentId: string): boolean
  call(
    botId: string,
    token: string,
    request: SkillToolRequest,
    signal: AbortSignal,
  ): Promise<{ text: string }>
  prepare(botId: string, token: string, agentId: string, signal: AbortSignal): Promise<void>
  list(botId: string, token: string, signal: AbortSignal): Promise<readonly BotSkillEntry[]>
  load(
    botId: string,
    token: string,
    name: string,
    signal: AbortSignal,
  ): Promise<(BotSkillEntry & { content: string }) | undefined>
  watch(botId: string, token: string, listener: () => void): () => void
  manageAsOwner(
    botId: string,
    place: SkillsPlace,
    args: SkillManageArgs,
    signal: AbortSignal,
  ): Promise<string>
  read(botId: string, place: SkillsPlace, signal: AbortSignal): Promise<SkillsReading>
  catalog(botId: string, place: SkillsPlace, signal: AbortSignal): Promise<SkillCatalog>
  sweep(
    botId: string,
    place: SkillsPlace,
    select: (skills: readonly SweptSkill[]) => readonly string[],
    reason: string,
    signal: AbortSignal,
  ): Promise<readonly string[]>
  subscribe(listener: (botId: string) => void): () => void
  forget(exists: (botId: string) => boolean): void
}

export function createBotSkills<A extends KindAgent>(deps: BotSkillsDeps<A>): BotSkills {
  const states = new Map<string, BotSkillsState>()
  const queues = new Map<string, Promise<unknown>>()
  const watchers = new Map<string, Set<() => void>>()
  const listeners = new Set<(botId: string) => void>()

  const stateOf = (botId: string): BotSkillsState => {
    let state = states.get(botId)
    if (state === undefined) {
      state = { library: createSkillLibrary(), viewed: new Map(), changeCounts: new Map() }
      states.set(botId, state)
    }
    return state
  }
  const withSkills = <T>(
    botId: string,
    work: (state: BotSkillsState) => Promise<T>,
  ): Promise<T> => {
    const previous = queues.get(botId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => work(stateOf(botId)))
    const settled = next.catch(() => undefined)
    queues.set(botId, settled)
    void settled.then(() => {
      if (queues.get(botId) === settled) queues.delete(botId)
    })
    return next
  }
  const changed = (botId: string) => {
    for (const watcher of [...(watchers.get(botId) ?? [])]) watcher()
    for (const listener of [...listeners]) listener(botId)
  }
  const manager = createSkillManager({ ...deps.history, changed })
  const requireSealed = (botId: string, token: string) => {
    if (!deps.sealed(botId, token)) {
      throw new Error(
        `bot-core: this preset revision of bot "${botId}" was not registered by this bot-core`,
      )
    }
  }
  const kindOf = (botId: string, token: string, agentId: string): BotSessionKind => {
    requireSealed(botId, token)
    const agent = deps.agent(agentId)
    if (agent === undefined || deps.botOf(agent) !== botId) {
      throw new Error(`bot-core: Agent "${agentId}" does not run a session of bot "${botId}"`)
    }
    return sessionKindOf(deps.kind, botId, agent)
  }
  const actorOf = (agentId: string, kind: BotSessionKind): SkillActor => {
    if (kind === "curator") return { kind: "curator", agentId }
    const review = deps.reviews.get(agentId)
    return review === undefined
      ? { kind: "conversation", agentId, sessionId: agentId }
      : { kind: "review", agentId, sessionId: review.sessionId }
  }
  const requirePlace = (botId: string, token: string) => {
    const place = deps.placeOf(botId, token)
    if (place === undefined) {
      throw new Error(
        `the environment of bot "${botId}" is not available, so its skills cannot be read`,
      )
    }
    return place
  }
  const entryOf = (place: SkillsPlace, name: string, description: string): BotSkillEntry => ({
    name,
    description,
    directory: posix.join(place.workspace, skillDirectory(name, false)),
  })
  const rescan = (botId: string, place: SkillsPlace, signal: AbortSignal) =>
    withSkills(botId, async (state) => {
      const before = state.library.current()?.fingerprint
      const catalog = await state.library.scan(place, signal)
      if (before !== undefined && before !== catalog.fingerprint) changed(botId)
      return catalog
    })

  return {
    available(botId, token, agentId) {
      try {
        return MANAGING_SESSIONS.includes(kindOf(botId, token, agentId))
      } catch {
        return false
      }
    },
    async call(botId, token, request, signal) {
      const kind = kindOf(botId, token, request.agentId)
      if (!MANAGING_SESSIONS.includes(kind)) {
        throw new SkillToolError(
          "skill_manage changes skills only in your conversations with your owner (your Main session and sessions your owner opens); here, read skills with the skill tool",
        )
      }
      const actor = actorOf(request.agentId, kind)
      const args = parseSkillArgs(request.args)
      if (actor.kind === "conversation" && changes(args.action) && deps.peerTurn(request.agentId)) {
        throw new SkillToolError(PEER_TURN_REFUSAL)
      }
      const place = requirePlace(botId, token)
      const text = await withSkills(botId, (state) =>
        manager.run(botId, state, place, actor, args, signal),
      )
      return { text }
    },
    async prepare(botId, token, agentId, signal) {
      const kind = kindOf(botId, token, agentId)
      if (MANAGING_SESSIONS.includes(kind) && deps.reviews.get(agentId) === undefined) {
        deps.stepped(botId, agentId)
      }
      const place = deps.placeOf(botId, token)
      if (place === undefined) return
      try {
        await rescan(botId, place, signal)
      } catch (error) {
        signal.throwIfAborted()
        deps.warn(`bot-core: could not read the skills of bot "${botId}": ${String(error)}`)
      }
    },
    async list(botId, token, signal) {
      requireSealed(botId, token)
      const place = requirePlace(botId, token)
      const catalog = await rescan(botId, place, signal)
      return deps.shield(
        botId,
        catalog.skills.map((skill) => entryOf(place, skill.name, skill.description)),
      )
    },
    async load(botId, token, name, signal) {
      requireSealed(botId, token)
      const place = requirePlace(botId, token)
      const loaded = await withSkills(botId, async (state) => {
        const directory = await state.library.directory(place, name, false, signal)
        const file = directory?.files.find((item) => item.path === SKILL_FILE)
        if (file === undefined) return undefined
        const parsed = parseSkill(file.text)
        return parsed.ok && parsed.value.name === name ? parsed.value : undefined
      })
      if (loaded === undefined) return undefined
      await deps.store.recordUse(botId, name, deps.now())
      return deps.shield(botId, {
        ...entryOf(place, name, loaded.description),
        content: loaded.body,
      })
    },
    watch(botId, _token, listener) {
      let set = watchers.get(botId)
      if (set === undefined) {
        set = new Set()
        watchers.set(botId, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    manageAsOwner: (botId, place, args, signal) =>
      withSkills(botId, (state) =>
        manager.run(botId, state, place, { kind: "owner" }, args, signal),
      ),
    async read(botId, place, signal) {
      return withSkills(botId, async (state) => {
        const before = state.library.current()?.fingerprint
        const catalog = await state.library.scan(place, signal)
        if (before !== undefined && before !== catalog.fingerprint) changed(botId)
        const archived = await state.library.archived(place, signal)
        return {
          active: catalog.skills.map(({ name, description }) => ({ name, description })),
          archived: archived.flatMap((entry) =>
            entry.skill.ok
              ? [{ name: entry.name, description: entry.skill.value.description }]
              : [],
          ),
          invalid: [
            ...catalog.invalid,
            ...archived.flatMap((entry) =>
              entry.skill.ok
                ? []
                : [
                    {
                      path: `${skillDirectory(entry.name, true)}/${SKILL_FILE}`,
                      problem: entry.skill.problem,
                    },
                  ],
            ),
          ],
        }
      })
    },
    catalog: (botId, place, signal) => rescan(botId, place, signal),
    sweep: (botId, place, select, reason, signal) =>
      withSkills(botId, (state) => manager.sweep(botId, state, place, select, reason, signal)),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    forget(exists) {
      for (const botId of [...states.keys()]) {
        if (exists(botId)) continue
        states.delete(botId)
        watchers.delete(botId)
      }
    },
  }
}
