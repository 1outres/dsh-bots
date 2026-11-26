import type {
  BotSessionKind,
  NoteMentionNotice,
  NoteStepRequest,
  NoteToolRequest,
  NoteToolResponse,
} from "../../internal"
import { authorshipOf } from "../channels/header"
import { type KindAgent, type SessionKindDeps, sessionKindOf } from "../prompt/session-kind"
import { mentionsIn, nameTable } from "./matching"
import type { NotesPlace, NotesView } from "./notebook"
import { createNotebook } from "./notebook"
import { pinnedNotes, renderPinned } from "./pinned"
import { describeNotes } from "./render"
import { MENTIONS_LEAD } from "./texts"
import {
  type BotNotesState,
  createNotesState,
  NOTE_TOOLS,
  type NoteTool,
  NoteToolError,
  type NoteTools,
} from "./tools"

export interface BotNotesDeps<A extends KindAgent> {
  sealed(botId: string, token: string): boolean
  agent(agentId: string): A | undefined
  botOf(agent: A): string | undefined
  kind: SessionKindDeps
  placeOf(botId: string, token: string): NotesPlace | undefined
  tools: NoteTools
  shield(botId: string, text: string): Promise<string>
  peerTurn(agentId: string): boolean
}

const PINNED_SESSIONS: readonly BotSessionKind[] = ["main", "web", "delegated", "schedule"]
const MENTION_SESSIONS: readonly BotSessionKind[] = ["main", "web", "delegated"]

export const PINNED_UNREADABLE =
  "Pinned notes could not be loaded for this step (your note tools may fail too)"

const SUMMARY_MAX = 120

const VAULT_UNCHECKED = "the vault guard could not check them for the bot's secrets"

export interface BotNotes {
  call(
    botId: string,
    token: string,
    request: NoteToolRequest,
    signal: AbortSignal,
  ): Promise<NoteToolResponse>
  prepare(
    botId: string,
    token: string,
    request: NoteStepRequest,
    signal: AbortSignal,
  ): Promise<NoteMentionNotice | undefined>
  pinned(botId: string, token: string, agentId: string): string
  withNotes<T>(botId: string, work: (state: BotNotesState) => Promise<T>): Promise<T>
  subscribe(listener: (botId: string) => void): () => void
  forget(exists: (botId: string) => boolean): void
}

export function createBotNotes<A extends KindAgent>(deps: BotNotesDeps<A>): BotNotes {
  const states = new Map<string, BotNotesState>()
  const failures = new Map<string, string>()
  const queues = new Map<string, Promise<unknown>>()
  const listeners = new Set<(botId: string) => void>()
  const pinnedTexts = new Map<string, string>()
  const renderPinnedOf = (view: NotesView) => {
    const { catalog } = view
    const notes = catalog.ids().map((id) => [id, catalog.note(id)] as const)
    return renderPinned(
      pinnedNotes(
        notes.flatMap(([id, note]) => (note === undefined ? [] : [[id, note] as const])),
        catalog.shown,
      ),
    )
  }

  const stateOf = (botId: string) => {
    const known = states.get(botId)
    if (known !== undefined) return known
    const state = createNotesState(createNotebook())
    states.set(botId, state)
    return state
  }

  const withNotes = <T>(botId: string, work: (state: BotNotesState) => Promise<T>): Promise<T> => {
    const previous = queues.get(botId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const state = stateOf(botId)
        const before = state.notebook.current()
        try {
          return await work(state)
        } finally {
          if (state.notebook.current() !== before) {
            for (const listener of [...listeners]) listener(botId)
          }
        }
      })
    const settled = next.catch(() => undefined)
    queues.set(botId, settled)
    void settled.then(() => {
      if (queues.get(botId) === settled) queues.delete(botId)
    })
    return next
  }

  const kindOf = (botId: string, token: string, agentId: string): BotSessionKind => {
    if (!deps.sealed(botId, token)) {
      throw new Error(
        `bot-core: this preset revision of bot "${botId}" was not registered by this bot-core`,
      )
    }
    const agent = deps.agent(agentId)
    if (agent === undefined || deps.botOf(agent) !== botId) {
      throw new Error(`bot-core: Agent "${agentId}" does not run a session of bot "${botId}"`)
    }
    return sessionKindOf(deps.kind, botId, agent)
  }

  const requirePlace = (botId: string, token: string) => {
    const place = deps.placeOf(botId, token)
    if (place === undefined)
      throw new Error(
        `the environment of bot "${botId}" is not available, so its notes cannot be read`,
      )
    return place
  }

  return {
    async call(botId, token, request, signal) {
      kindOf(botId, token, request.agentId)
      if (!(NOTE_TOOLS as readonly string[]).includes(request.tool))
        throw new NoteToolError(`unknown note tool ${request.tool}`)
      const place = requirePlace(botId, token)
      const pinned = deps.peerTurn(request.agentId) ? "locked" : "open"
      const text = await withNotes(botId, (state) =>
        deps.tools.call(state, place, request.tool as NoteTool, request.args, signal, pinned),
      )
      return { text }
    },
    async prepare(botId, token, request, signal) {
      const kind = kindOf(botId, token, request.agentId)
      if (!PINNED_SESSIONS.includes(kind) && !MENTION_SESSIONS.includes(kind)) return undefined
      let view: NotesView
      try {
        const place = requirePlace(botId, token)
        view = await withNotes(botId, (state) => state.notebook.load(place, signal))
      } catch (error) {
        signal.throwIfAborted()
        failures.set(botId, error instanceof Error ? error.message : String(error))
        pinnedTexts.delete(botId)
        return undefined
      }
      try {
        pinnedTexts.set(botId, await deps.shield(botId, renderPinnedOf(view)))
        failures.delete(botId)
      } catch {
        failures.set(botId, VAULT_UNCHECKED)
        pinnedTexts.delete(botId)
        return undefined
      }
      if (!MENTION_SESSIONS.includes(kind)) return undefined
      const owned = request.messages
        .filter((message) => message.fromUser)
        .map((message) => authorshipOf(message.text))
        .filter((authorship) => authorship.owner)
        .map((authorship) => authorship.body)
      if (owned.length === 0) return undefined
      const mentions = mentionsIn(owned.join("\n\n"), nameTable(view.catalog))
      if (mentions.length === 0) return undefined
      const summary = `Notes mentioned: ${mentions.map((mention) => mention.text).join(", ")}`
      const text = [
        MENTIONS_LEAD,
        ...mentions.map(
          (mention) => `- "${mention.text}" → ${describeNotes(view.catalog, mention.ids)}`,
        ),
      ].join("\n")
      try {
        return {
          text: await deps.shield(botId, text),
          summary: await deps.shield(
            botId,
            summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary,
          ),
        }
      } catch {
        return undefined
      }
    },
    pinned(botId, token, agentId) {
      const kind = kindOf(botId, token, agentId)
      if (!PINNED_SESSIONS.includes(kind)) return ""
      const failure = failures.get(botId)
      if (failure !== undefined) return `${PINNED_UNREADABLE}: ${failure}`
      return pinnedTexts.get(botId) ?? ""
    },
    withNotes,
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
        failures.delete(botId)
        pinnedTexts.delete(botId)
      }
    },
  }
}
