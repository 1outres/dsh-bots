/**
 * What the notes row asks the `bot` service (src/plugins/notes.ts): the note
 * tools, the step preparation (the notes brought up to date from the files,
 * and the notice of the notes an owner's message names) and the pinned notes
 * context. Only an Agent of the bot, asking with a token of a revision
 * registered during this load, is answered; its session's kind decides what
 * it gets (docs/specs/bot-notes.md §5, §6).
 */
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
  /** Whether `token` is the token of a revision of the bot's preset registered during this load. */
  sealed(botId: string, token: string): boolean
  agent(agentId: string): A | undefined
  /** The bot the Agent's session verifiably belongs to (host/preset/identity.ts). */
  botOf(agent: A): string | undefined
  kind: SessionKindDeps
  /** The file system that revision's files row handed over, with the environment's workspace. */
  placeOf(botId: string, token: string): NotesPlace | undefined
  tools: NoteTools
}

/** Sessions whose context carries the pinned notes (§6). */
const PINNED_SESSIONS: readonly BotSessionKind[] = ["main", "web", "delegated", "schedule"]
/** Sessions told which notes an owner's message names (§5). */
const MENTION_SESSIONS: readonly BotSessionKind[] = ["main", "web", "delegated"]

/** What the pinned notes context says while the notes cannot be read. */
export const PINNED_UNREADABLE =
  "Pinned notes could not be loaded for this step (your note tools may fail too)"

/** Bound of a notice's one-line summary (dsh-llm CONTEXT_SUMMARY_MAX_CHARS). */
const SUMMARY_MAX = 120

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
  /** Runs `work` with the bot's notes, after every operation already asked for. */
  withNotes<T>(botId: string, work: (state: BotNotesState) => Promise<T>): Promise<T>
  /** Called with the bot id whenever what is known of its notes changed (a write, or files read that changed). */
  subscribe(listener: (botId: string) => void): () => void
  /** Drop what is kept of bots that no longer exist. */
  forget(exists: (botId: string) => boolean): void
}

export function createBotNotes<A extends KindAgent>(deps: BotNotesDeps<A>): BotNotes {
  const states = new Map<string, BotNotesState>()
  /** Why the bot's notes could not be read before its latest step, until they can be again. */
  const failures = new Map<string, string>()
  const queues = new Map<string, Promise<unknown>>()
  const listeners = new Set<(botId: string) => void>()

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
      const text = await withNotes(botId, (state) =>
        deps.tools.call(state, place, request.tool as NoteTool, request.args, signal),
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
        failures.delete(botId)
      } catch (error) {
        signal.throwIfAborted()
        failures.set(botId, error instanceof Error ? error.message : String(error))
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
      return {
        text: [
          MENTIONS_LEAD,
          ...mentions.map(
            (mention) => `- "${mention.text}" → ${describeNotes(view.catalog, mention.ids)}`,
          ),
        ].join("\n"),
        summary: summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary,
      }
    },
    pinned(botId, token, agentId) {
      const kind = kindOf(botId, token, agentId)
      if (!PINNED_SESSIONS.includes(kind)) return ""
      const failure = failures.get(botId)
      if (failure !== undefined) return `${PINNED_UNREADABLE}: ${failure}`
      const view = states.get(botId)?.notebook.current()
      if (view === undefined) return ""
      const { catalog } = view
      const notes = catalog.ids().map((id) => [id, catalog.note(id)] as const)
      return renderPinned(
        pinnedNotes(
          notes.flatMap(([id, note]) => (note === undefined ? [] : [[id, note] as const])),
          catalog.shown,
        ),
      )
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
      }
    },
  }
}
