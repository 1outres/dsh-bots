export type MatrixFailureKind =
  | "token"
  | "forbidden"
  | "not-found"
  | "user-in-use"
  | "exclusive"
  | "bad-since"
  | "too-large"
  | "unreachable"
  | "rejected"

export class MatrixError extends Error {
  override readonly name = "MatrixError"
  constructor(
    readonly kind: MatrixFailureKind,
    message: string,
    readonly status?: number,
    readonly errcode?: string,
  ) {
    super(message)
  }
}

export const isMatrixError = (error: unknown, kind?: MatrixFailureKind): error is MatrixError =>
  error instanceof MatrixError && (kind === undefined || error.kind === kind)

export interface MatrixEvent {
  readonly eventId: string
  readonly type: string
  readonly sender: string
  readonly originServerTs: number
  readonly content: Readonly<Record<string, unknown>>
  readonly stateKey?: string
  readonly redacts?: string
}

export interface MatrixStrippedState {
  readonly type: string
  readonly sender: string
  readonly stateKey: string
  readonly content: Readonly<Record<string, unknown>>
}

export interface MatrixJoinedRoom {
  readonly timeline: readonly MatrixEvent[]
  readonly limited: boolean
  readonly prevBatch?: string
  readonly state: readonly MatrixEvent[]
}

export interface MatrixSync {
  readonly nextBatch: string
  readonly joined: ReadonlyMap<string, MatrixJoinedRoom>
  readonly invited: ReadonlyMap<string, readonly MatrixStrippedState[]>
  readonly left: ReadonlySet<string>
}

export interface MatrixSyncRequest {
  readonly since?: string
  readonly timeoutMs: number
  readonly filter: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
}

export interface MatrixMessagesPage {
  readonly chunk: readonly MatrixEvent[]
  readonly end?: string
}

export interface MatrixMember {
  readonly userId: string
  readonly membership: "join" | "invite" | "leave" | "ban" | "knock"
  readonly displayName?: string
  readonly avatarUrl?: string
}

export interface MatrixProfile {
  readonly displayName?: string
  readonly avatarUrl?: string
}

export interface MatrixMedia {
  readonly data: Uint8Array
  readonly contentType: string
}

export interface MatrixCreateRoom {
  readonly preset: "trusted_private_chat" | "private_chat"
  readonly isDirect: boolean
  readonly invite: readonly string[]
  readonly name?: string
}

export interface MatrixApi {
  readonly user: string | undefined
  as(userId: string): MatrixApi
  unauthenticated(path: string, signal: AbortSignal): Promise<unknown>
  versions(signal: AbortSignal): Promise<readonly string[]>
  whoami(signal: AbortSignal): Promise<string>
  register(localpart: string, signal: AbortSignal): Promise<"created" | "exists">
  deactivate(signal: AbortSignal): Promise<void>
  uploadLimit(signal: AbortSignal): Promise<number | undefined>
  sync(request: MatrixSyncRequest): Promise<MatrixSync>
  messages(
    roomId: string,
    from: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<MatrixMessagesPage>
  send(
    roomId: string,
    type: string,
    content: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<string>
  redact(roomId: string, eventId: string, signal: AbortSignal): Promise<void>
  typing(roomId: string, typing: boolean, timeoutMs: number, signal: AbortSignal): Promise<void>
  receipt(roomId: string, eventId: string, signal: AbortSignal): Promise<void>
  createRoom(room: MatrixCreateRoom, signal: AbortSignal): Promise<string>
  join(roomId: string, signal: AbortSignal): Promise<void>
  leave(roomId: string, signal: AbortSignal): Promise<void>
  forget(roomId: string, signal: AbortSignal): Promise<void>
  joinedRooms(signal: AbortSignal): Promise<readonly string[]>
  members(roomId: string, signal: AbortSignal): Promise<readonly MatrixMember[]>
  state(
    roomId: string,
    type: string,
    stateKey: string,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>> | undefined>
  putState(
    roomId: string,
    type: string,
    stateKey: string,
    content: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<void>
  profile(userId: string, signal: AbortSignal): Promise<MatrixProfile | undefined>
  setDisplayName(name: string, signal: AbortSignal): Promise<void>
  setAvatarUrl(url: string, signal: AbortSignal): Promise<void>
  accountData(
    type: string,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>> | undefined>
  setAccountData(
    type: string,
    content: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<void>
  upload(data: Uint8Array, contentType: string, name: string, signal: AbortSignal): Promise<string>
  download(mxc: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>
  thumbnail(mxc: string, size: number, signal: AbortSignal): Promise<MatrixMedia | undefined>
}

export type OpenMatrixApi = (homeserver: string, asToken: string) => MatrixApi
