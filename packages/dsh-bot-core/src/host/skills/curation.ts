/**
 * When a bot's skills are curated (docs/specs/bot-skills.md §12): the daily
 * archive of unused skills once {@link SWEEP_EVERY_MS} has passed since the
 * last one, and the weekly curation by the model once
 * {@link CURATION_EVERY_MS} has, while the bot's `skillCurator` is on, after
 * its Main session has been quiet for {@link CURATION_QUIET_MS}, and only when
 * the skills call for it ({@link calledForCuration}). The last times are
 * stored, so a restart keeps counting from them. One timer wakes for the
 * earliest due bot; what cannot run now (an environment that cannot be read,
 * skills that do not call for it) waits for the bot's next change or
 * {@link CURATION_RETRY_MS}.
 */

import type { CurationOutcome } from "./curation-run"
import { DAY_MS } from "./retention"
import type { SkillStore } from "./store"
import { SLIM_BYTES } from "./texts"

export const SWEEP_EVERY_MS = DAY_MS
export const CURATION_EVERY_MS = 7 * DAY_MS
/** How long the Main session stays quiet before a curation starts. */
export const CURATION_QUIET_MS = 30_000
/** When a run that could not run is tried again, unless the bot changes first. */
export const CURATION_RETRY_MS = 60 * 60_000
/** Active skills that call for a curation (a merge needs two). */
export const CURATION_MIN_SKILLS = 2

/** Whether the bot's active skills call for a curation: two or more, or one SKILL.md over {@link SLIM_BYTES}. */
export function calledForCuration(skills: readonly { readonly bytes: number }[]): boolean {
  return skills.length >= CURATION_MIN_SKILLS || skills.some((skill) => skill.bytes > SLIM_BYTES)
}

export type SweepOutcome = "swept" | "unavailable"

export interface SkillCurationDeps {
  bots(): readonly string[]
  store: Pick<SkillStore, "curation" | "markSwept" | "markCurated" | "curatorEnabled">
  /** Archive the bot's unused skills. */
  sweep(botId: string): Promise<SweepOutcome>
  /** The bot's active skills, or undefined while they cannot be read. */
  skills(botId: string): Promise<readonly { readonly bytes: number }[] | undefined>
  mainOf(botId: string): string | undefined
  /** The session runs no turn and has nothing waiting (true for a session not loaded). */
  idle(sessionId: string): boolean
  /** Curate the bot's skills with the model; resolves when it is over. */
  curate(botId: string): Promise<CurationOutcome>
  now(): number
  later(ms: number, work: () => void): () => void
  /** Longest delay one timer may take. */
  readonly maxDelayMs: number
  warn(message: string): void
}

export interface SkillCuration {
  /** Look again: the bot (every bot without one) changed; what waited for a change may run. */
  sync(botId?: string): void
  /** Something happened in a session: a Main's quiet wait starts over. */
  activity(sessionId: string): void
  dispose(): void
}

interface Task {
  running: boolean
  /** Not before this time (Infinity: not until the bot changes). */
  heldUntil: number
}

interface BotState {
  readonly sweep: Task
  readonly curation: Task
  quiet: (() => void) | undefined
  /** The quiet wait ended while the Main was working: it starts again at the Main's next activity. */
  awaitingIdle: boolean
}

export function createSkillCuration(deps: SkillCurationDeps): SkillCuration {
  const states = new Map<string, BotState>()
  let timer: (() => void) | undefined
  let disposed = false

  const stateOf = (botId: string): BotState => {
    let state = states.get(botId)
    if (state === undefined) {
      state = {
        sweep: { running: false, heldUntil: 0 },
        curation: { running: false, heldUntil: 0 },
        quiet: undefined,
        awaitingIdle: false,
      }
      states.set(botId, state)
    }
    return state
  }
  const dueAt = (last: number | undefined, every: number, task: Task) =>
    Math.max(last === undefined ? 0 : last + every, task.heldUntil)
  const sweepDueAt = (botId: string, state: BotState) =>
    dueAt(deps.store.curation(botId).sweptAt, SWEEP_EVERY_MS, state.sweep)
  const curationDueAt = (botId: string, state: BotState) =>
    dueAt(deps.store.curation(botId).curatedAt, CURATION_EVERY_MS, state.curation)
  const wantsCuration = (botId: string, state: BotState) =>
    !state.curation.running && deps.store.curatorEnabled(botId) && deps.mainOf(botId) !== undefined
  const stopQuiet = (state: BotState) => {
    state.quiet?.()
    state.quiet = undefined
    state.awaitingIdle = false
  }
  const hold = (task: Task) => {
    task.heldUntil = deps.now() + CURATION_RETRY_MS
  }
  const failed = (what: string, botId: string, error: unknown) => {
    deps.warn(`bot-core: the ${what} of bot "${botId}"'s skills failed: ${String(error)}`)
  }

  const startSweep = (botId: string, state: BotState) => {
    const at = deps.now()
    state.sweep.running = true
    deps
      .sweep(botId)
      .then(async (outcome) => {
        if (outcome === "swept") await deps.store.markSwept(botId, at)
        else hold(state.sweep)
      })
      .catch((error: unknown) => {
        failed("daily archive", botId, error)
        hold(state.sweep)
      })
      .finally(() => {
        state.sweep.running = false
        tick()
      })
  }

  const curate = async (botId: string, state: BotState) => {
    const at = deps.now()
    const skills = await deps.skills(botId)
    if (skills === undefined) {
      hold(state.curation)
      return
    }
    if (!calledForCuration(skills)) {
      state.curation.heldUntil = Number.POSITIVE_INFINITY
      return
    }
    const outcome = await deps.curate(botId)
    if (outcome.kind === "ran") await deps.store.markCurated(botId, at)
    else hold(state.curation)
  }

  const quietEnded = (botId: string, state: BotState) => {
    state.quiet = undefined
    if (disposed || !wantsCuration(botId, state) || curationDueAt(botId, state) > deps.now()) {
      tick()
      return
    }
    const main = deps.mainOf(botId)
    if (main === undefined) return
    if (!deps.idle(main)) {
      state.awaitingIdle = true
      return
    }
    state.curation.running = true
    curate(botId, state)
      .catch((error: unknown) => {
        failed("curation", botId, error)
        hold(state.curation)
      })
      .finally(() => {
        state.curation.running = false
        tick()
      })
  }

  const waitForQuiet = (botId: string, state: BotState) => {
    state.quiet?.()
    state.awaitingIdle = false
    state.quiet = deps.later(CURATION_QUIET_MS, () => quietEnded(botId, state))
  }

  const tick = () => {
    if (disposed) return
    timer?.()
    timer = undefined
    const now = deps.now()
    const bots = new Set(deps.bots())
    for (const [botId, state] of [...states]) {
      if (bots.has(botId)) continue
      stopQuiet(state)
      states.delete(botId)
    }
    let next = Number.POSITIVE_INFINITY
    for (const botId of bots) {
      const state = stateOf(botId)
      if (!state.sweep.running) {
        const at = sweepDueAt(botId, state)
        if (at <= now) startSweep(botId, state)
        else next = Math.min(next, at)
      }
      if (!wantsCuration(botId, state)) {
        if (!state.curation.running) stopQuiet(state)
        continue
      }
      if (state.quiet !== undefined || state.awaitingIdle) continue
      const at = curationDueAt(botId, state)
      if (at <= now) waitForQuiet(botId, state)
      else next = Math.min(next, at)
    }
    if (next === Number.POSITIVE_INFINITY) return
    timer = deps.later(Math.min(deps.maxDelayMs, Math.max(0, next - now)), () => {
      timer = undefined
      tick()
    })
  }

  return {
    sync(botId) {
      for (const [id, state] of states) {
        if (botId !== undefined && id !== botId) continue
        state.sweep.heldUntil = 0
        state.curation.heldUntil = 0
      }
      tick()
    },
    activity(sessionId) {
      for (const [botId, state] of states) {
        if (deps.mainOf(botId) !== sessionId) continue
        if (state.quiet !== undefined || state.awaitingIdle) waitForQuiet(botId, state)
      }
    },
    dispose() {
      disposed = true
      timer?.()
      timer = undefined
      for (const state of states.values()) stopQuiet(state)
      states.clear()
    },
  }
}
