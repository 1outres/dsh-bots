export type BotManagedTarget =
  | { readonly kind: "bot" }
  | { readonly kind: "workspace"; readonly workspaceId: string }

export type BotManagedTargetKind = BotManagedTarget["kind"]

export type BotManagedAnswerer = "main" | "owner"

export const BOT_MANAGED_ANSWERERS: readonly BotManagedAnswerer[] = ["main", "owner"]

export type BotManagedOrigin = "main" | "owner"

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
  readonly label?: string
  readonly since: number
}

export interface BotManagedSessionsSnapshot {
  readonly sessions: readonly BotManagedSession[]
}

export interface BotManagedSessionsApi {
  watch(signal?: AbortSignal): AsyncIterable<BotManagedSessionsSnapshot>
  entrust(botId: string, sessionId: string): Promise<BotManagedSession>
  release(botId: string, sessionId: string): Promise<BotManagedSessionsSnapshot>
  setAnswerer(
    botId: string,
    sessionId: string,
    answerer: BotManagedAnswerer,
  ): Promise<BotManagedSession>
}

export function parseAnswerer(value: unknown): BotManagedAnswerer {
  if (value !== "main" && value !== "owner") throw new Error('answerer must be "main" or "owner"')
  return value
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/

export function parseManagedId(value: unknown, what: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${what} is invalid`)
  return value
}

export function managedSessionOf(
  snapshot: BotManagedSessionsSnapshot,
  sessionId: string,
): BotManagedSession | undefined {
  return snapshot.sessions.find((session) => session.sessionId === sessionId)
}
export function workspaceOfTarget(target: BotManagedTarget): string | undefined {
  return target.kind === "workspace" ? target.workspaceId : undefined
}
