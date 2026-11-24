/**
 * Sessions a bot's Main session operates (docs/specs/bot-managed-sessions.md):
 * the record of each, the `botManagedSessions` Remote the owner hands
 * sessions over with, and the checks its (untrusted) input passes.
 */

/** Where a managed session runs: the bot's own environment, or a DSH Workspace the owner granted the bot (spec §10). */
export type BotManagedTarget =
  | { readonly kind: "bot" }
  | { readonly kind: "workspace"; readonly workspaceId: string }

export type BotManagedTargetKind = BotManagedTarget["kind"]

/** Who answers the session's questions and plan reviews. */
export type BotManagedAnswerer = "main" | "owner"

export const BOT_MANAGED_ANSWERERS: readonly BotManagedAnswerer[] = ["main", "owner"]

/** How the management began: the Main session started it, or the owner handed it over. */
export type BotManagedOrigin = "main" | "owner"

/** The answerer a session gets when nobody chose one, per target kind. */
export const DEFAULT_ANSWERER: { readonly [Kind in BotManagedTargetKind]: BotManagedAnswerer } = {
  bot: "main",
  workspace: "owner",
}

export interface BotManagedSession {
  readonly botId: string
  readonly sessionId: string
  readonly target: BotManagedTarget
  readonly answerer: BotManagedAnswerer
  readonly origin: BotManagedOrigin
  /** The title the Main session started it with; absent for one the owner handed over. */
  readonly label?: string
  readonly since: number
}

/** What the `botManagedSessions` Remote's `watch` streams. */
export interface BotManagedSessionsSnapshot {
  /** Every managed session of every bot, oldest first. */
  readonly sessions: readonly BotManagedSession[]
}

/** The `botManagedSessions` Remote: the owner's side of managed sessions. */
export interface BotManagedSessionsApi {
  /** The current snapshot, then one after every change. */
  watch(signal?: AbortSignal): AsyncIterable<BotManagedSessionsSnapshot>
  /**
   * Hand a session to the bot's Main session, with the target's default answerer: one of the
   * bot's sessions, or a session of a DSH Workspace granted to the bot.
   * @throws when the session cannot be managed (its Main, a schedule run's, archived, another bot's,
   *   one of a Workspace the bot is not granted).
   */
  entrust(botId: string, sessionId: string): Promise<BotManagedSession>
  /** Take the session back; the Main session is told. @throws when it is not managed. */
  release(botId: string, sessionId: string): Promise<BotManagedSessionsSnapshot>
  /** Choose who answers its questions. @throws when it is not managed. */
  setAnswerer(
    botId: string,
    sessionId: string,
    answerer: BotManagedAnswerer,
  ): Promise<BotManagedSession>
}

/** An answerer (untrusted input). */
export function parseAnswerer(value: unknown): BotManagedAnswerer {
  if (value !== "main" && value !== "owner") throw new Error('answerer must be "main" or "owner"')
  return value
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/

/** A bot or session id (untrusted input). */
export function parseManagedId(value: unknown, what: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${what} is invalid`)
  return value
}

/** The managed session of `sessionId` in a snapshot. */
export function managedSessionOf(
  snapshot: BotManagedSessionsSnapshot,
  sessionId: string,
): BotManagedSession | undefined {
  return snapshot.sessions.find((session) => session.sessionId === sessionId)
}
/** The id of a managed session's DSH Workspace, if it runs in one. */
export function workspaceOfTarget(target: BotManagedTarget): string | undefined {
  return target.kind === "workspace" ? target.workspaceId : undefined
}
