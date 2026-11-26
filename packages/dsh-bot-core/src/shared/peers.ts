export const MAX_GROUP_NAME_LENGTH = 40

export const MAX_GROUP_PURPOSE_LENGTH = 500

export const MAX_MEMBER_ROLE_LENGTH = 200

export const PEER_MESSAGE_PAGE = 40

export type BotPeerLimit = "thread" | "pair" | "group" | "sender" | "depth"

export const BOT_PEER_LIMITS: readonly BotPeerLimit[] = [
  "thread",
  "pair",
  "group",
  "sender",
  "depth",
]

export type BotGroupPause =
  | { readonly reason: "owner"; readonly at: number }
  | { readonly reason: "limit"; readonly at: number; readonly detail: BotPeerLimit }

export type BotPeerMessageState = "queued" | "delivered" | "withdrawn" | "expired" | "refused"

export const BOT_PEER_MESSAGE_STATES: readonly BotPeerMessageState[] = [
  "queued",
  "delivered",
  "withdrawn",
  "expired",
  "refused",
]

export type BotPeerWithdrawal = "group-deleted" | "left-group" | "bot-deleted" | "expired"

export const BOT_PEER_WITHDRAWALS: readonly BotPeerWithdrawal[] = [
  "group-deleted",
  "left-group",
  "bot-deleted",
  "expired",
]

export type BotPeerRefusal = BotPeerLimit | "paused"

export const BOT_PEER_REFUSALS: readonly BotPeerRefusal[] = [...BOT_PEER_LIMITS, "paused"]

export interface BotGroupMemberView {
  readonly botId: string
  readonly role: string
  readonly joinedAt: number
}

export interface BotGroupView {
  readonly id: string
  readonly name: string
  readonly purpose: string
  readonly members: readonly BotGroupMemberView[]
  readonly paused?: BotGroupPause
  readonly createdAt: number
}

export interface BotPeerMessageView {
  readonly id: string
  readonly groupId: string
  readonly from: string
  readonly to: string
  readonly threadId: string
  readonly replyTo?: string
  readonly expectsReply: boolean
  readonly depth: number
  readonly text: string
  readonly sentAt: number
  readonly state: BotPeerMessageState
  readonly refusal?: BotPeerRefusal
  readonly withdrawal?: BotPeerWithdrawal
}

export interface BotGroupsSnapshot {
  readonly groups: readonly BotGroupView[]
}

export interface BotPeerMessagePage {
  readonly messages: readonly BotPeerMessageView[]
  readonly earlier?: string
}

export interface BotGroupInput {
  readonly name: string
  readonly purpose: string
}

export interface BotGroupChange {
  readonly name?: string
  readonly purpose?: string
}

export interface BotGroupJoin {
  readonly role: string
  readonly from?: string
}

export interface BotGroupsApi {
  watch(signal?: AbortSignal): AsyncIterable<BotGroupsSnapshot>
  messages(
    groupId: string,
    before: string | undefined,
    signal?: AbortSignal,
  ): Promise<BotPeerMessagePage>
  create(input: BotGroupInput): Promise<BotGroupView>
  update(groupId: string, change: BotGroupChange): Promise<BotGroupView>
  deleteGroup(groupId: string): Promise<BotGroupsSnapshot>
  join(groupId: string, botId: string, join: BotGroupJoin): Promise<BotGroupView>
  leave(botId: string): Promise<BotGroupsSnapshot>
  setRole(botId: string, role: string): Promise<BotGroupView>
  setPaused(groupId: string, paused: boolean): Promise<BotGroupView>
}

const LINE_BREAK = /[\n\r\u0085\u2028\u2029]/u
const HIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/u
const HIDDEN_BUT_NEWLINE = /[\p{Cf}\u2028\u2029]|(?!\n)\p{Cc}/u

const lengthOf = (text: string) => [...text].length

function fieldsOf(input: unknown, what: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${what} must be an object`)
  }
  const unknown = Object.keys(input).filter((key) => !keys.includes(key))
  if (unknown.length > 0) throw new Error(`${what} has unknown fields: ${unknown.join(", ")}`)
  return input as Record<string, unknown>
}

function singleLine(value: string, field: string): string {
  if (LINE_BREAK.test(value)) throw new Error(`the ${field} must be a single line`)
  if (HIDDEN.test(value)) throw new Error(`the ${field} has control or format characters`)
  return value
}

export function parseGroupName(name: unknown): string {
  if (typeof name !== "string") throw new Error("the group name must be a string")
  const trimmed = singleLine(name.trim(), "group name")
  if (trimmed.length === 0) throw new Error("the group name is empty")
  if (lengthOf(trimmed) > MAX_GROUP_NAME_LENGTH) {
    throw new Error(`the group name is longer than ${MAX_GROUP_NAME_LENGTH} characters`)
  }
  return trimmed
}

export function parseGroupPurpose(purpose: unknown): string {
  if (typeof purpose !== "string") throw new Error("the group purpose must be a string")
  const trimmed = purpose.trim()
  if (HIDDEN_BUT_NEWLINE.test(trimmed)) {
    throw new Error("the group purpose has control or format characters")
  }
  if (lengthOf(trimmed) > MAX_GROUP_PURPOSE_LENGTH) {
    throw new Error(`the group purpose is longer than ${MAX_GROUP_PURPOSE_LENGTH} characters`)
  }
  return trimmed
}

export function parseMemberRole(role: unknown): string {
  if (typeof role !== "string") throw new Error("the role must be a string")
  const trimmed = singleLine(role.trim(), "role")
  if (lengthOf(trimmed) > MAX_MEMBER_ROLE_LENGTH) {
    throw new Error(`the role is longer than ${MAX_MEMBER_ROLE_LENGTH} characters`)
  }
  return trimmed
}

export function parseGroupInput(input: unknown): BotGroupInput {
  const value = fieldsOf(input, "a new group", ["name", "purpose"])
  return { name: parseGroupName(value.name), purpose: parseGroupPurpose(value.purpose) }
}

export function parseGroupChange(input: unknown): BotGroupChange {
  const value = fieldsOf(input, "a group change", ["name", "purpose"])
  if (value.name === undefined && value.purpose === undefined) {
    throw new Error("a group change needs a name or a purpose")
  }
  return {
    ...(value.name === undefined ? {} : { name: parseGroupName(value.name) }),
    ...(value.purpose === undefined ? {} : { purpose: parseGroupPurpose(value.purpose) }),
  }
}

export function parseGroupJoin(input: unknown): BotGroupJoin {
  const value = fieldsOf(input, "a join", ["role", "from"])
  return {
    role: parseMemberRole(value.role),
    ...(value.from === undefined ? {} : { from: parseGroupId(value.from) }),
  }
}

export function parseGroupPaused(paused: unknown): boolean {
  if (typeof paused !== "boolean") throw new Error("paused must be true or false")
  return paused
}

export function parseGroupId(groupId: unknown): string {
  if (typeof groupId !== "string" || groupId === "") throw new Error("a group id must be a string")
  return groupId
}

export function parseBotId(botId: unknown): string {
  if (typeof botId !== "string" || botId === "") throw new Error("a bot id must be a string")
  return botId
}

export function parseMessageCursor(before: unknown): string | undefined {
  if (before === undefined) return undefined
  if (typeof before !== "string" || before === "") {
    throw new Error("before must be the id of a message")
  }
  return before
}
