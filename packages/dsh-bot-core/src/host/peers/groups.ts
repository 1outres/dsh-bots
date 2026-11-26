import type {
  BotGroupChange,
  BotGroupInput,
  BotGroupJoin,
  BotPeerLimit,
  BotPeerWithdrawal,
} from "../../shared/peers"
import { headerName } from "../channels/header"
import type { PeerGroupRecord, PeerMemberRecord, PeerMessageRecord } from "./domain"
import type { PeerDecision, PeerState, PeerStore, PeerWrite } from "./store"

export type PeerBot =
  | { readonly state: "listed"; readonly name: string }
  | { readonly state: "creating"; readonly name: string }
  | { readonly state: "missing" }

export interface PeerWithdrawn {
  readonly messageId: string
  readonly message: PeerMessageRecord
}

export interface PeerMember {
  readonly botId: string
  readonly member: PeerMemberRecord
}

export interface PeerMembership {
  readonly groupId: string
  readonly group: PeerGroupRecord
  readonly member: PeerMemberRecord
  readonly peers: readonly PeerMember[]
}

export interface PeerRules {
  readonly bot: (botId: string) => PeerBot
  readonly now: number
}

export function groupNameKey(name: string): string {
  return headerName(name).toLowerCase()
}

const byJoin = (left: PeerMember, right: PeerMember) =>
  left.member.joinedAt - right.member.joinedAt ||
  (left.botId < right.botId ? -1 : left.botId > right.botId ? 1 : 0)

export function membersOf(state: PeerState, groupId: string): readonly PeerMember[] {
  return [...state.members]
    .filter(([, member]) => member.groupId === groupId)
    .map(([botId, member]) => ({ botId, member }))
    .sort(byJoin)
}

export function membershipOf(state: PeerState, botId: string): PeerMembership | undefined {
  const member = state.members.get(botId)
  if (member === undefined) return undefined
  const group = state.groups.get(member.groupId)
  if (group === undefined) return undefined
  return {
    groupId: member.groupId,
    group,
    member,
    peers: membersOf(state, member.groupId).filter((peer) => peer.botId !== botId),
  }
}

export function sharedGroupOf(
  state: PeerState,
  botId: string,
  otherId: string,
): string | undefined {
  if (botId === otherId) return undefined
  const mine = state.members.get(botId)
  const theirs = state.members.get(otherId)
  if (mine === undefined || theirs === undefined || mine.groupId !== theirs.groupId)
    return undefined
  return state.groups.has(mine.groupId) ? mine.groupId : undefined
}

export function requireGroup(state: PeerState, groupId: string): PeerGroupRecord {
  const group = state.groups.get(groupId)
  if (group === undefined) throw new Error(`no group "${groupId}"`)
  return group
}

function botName(rules: PeerRules, botId: string): string {
  const bot = rules.bot(botId)
  return bot.state === "missing" ? botId : bot.name
}

function requireListed(rules: PeerRules, botId: string): string {
  const bot = rules.bot(botId)
  switch (bot.state) {
    case "listed":
      return bot.name
    case "creating":
      throw new Error(`bot "${bot.name}" is still being created`)
    case "missing":
      throw new Error(`no bot "${botId}"`)
  }
}

function requireFreeName(state: PeerState, name: string, except?: string): void {
  const key = groupNameKey(name)
  if (key === "") throw new Error("the group name needs a character other than [ ] ( ) ·")
  for (const [groupId, group] of state.groups) {
    if (groupId !== except && groupNameKey(group.name) === key) {
      throw new Error(`a group named "${group.name}" already exists`)
    }
  }
}

function withdrawals(
  state: PeerState,
  involved: (message: PeerMessageRecord) => boolean,
  withdrawal: BotPeerWithdrawal,
): readonly PeerWithdrawn[] {
  return [...state.messages]
    .filter(([, message]) => message.state === "queued" && involved(message))
    .map(([messageId, message]) => ({
      messageId,
      message: { ...message, state: "withdrawn", withdrawal },
    }))
}

const putMessages = (withdrawn: readonly PeerWithdrawn[]): PeerWrite[] =>
  withdrawn.map(({ messageId, message }) => ({
    kind: "put-message",
    messageId,
    record: message,
  }))

const involving = (groupId: string, botId: string) => (message: PeerMessageRecord) =>
  message.groupId === groupId && (message.from === botId || message.to === botId)

export function decideCreate(
  state: PeerState,
  groupId: string,
  input: BotGroupInput,
  rules: PeerRules,
): PeerDecision<string> {
  if (state.groups.has(groupId)) throw new Error(`group "${groupId}" already exists`)
  requireFreeName(state, input.name)
  return {
    writes: [
      {
        kind: "put-group",
        groupId,
        record: { name: input.name, purpose: input.purpose, createdAt: rules.now },
      },
    ],
    result: groupId,
  }
}

export function decideUpdate(
  state: PeerState,
  groupId: string,
  change: BotGroupChange,
): PeerDecision<string> {
  const group = requireGroup(state, groupId)
  if (change.name !== undefined) requireFreeName(state, change.name, groupId)
  return {
    writes: [
      {
        kind: "put-group",
        groupId,
        record: {
          ...group,
          ...(change.name === undefined ? {} : { name: change.name }),
          ...(change.purpose === undefined ? {} : { purpose: change.purpose }),
        },
      },
    ],
    result: groupId,
  }
}

export function decideDelete(
  state: PeerState,
  groupId: string,
): PeerDecision<readonly PeerWithdrawn[]> {
  requireGroup(state, groupId)
  const withdrawn = withdrawals(state, (message) => message.groupId === groupId, "group-deleted")
  return { writes: [{ kind: "delete-group", groupId }], result: withdrawn }
}

export interface PeerJoined {
  readonly groupId: string
  readonly withdrawn: readonly PeerWithdrawn[]
}

export function decideJoin(
  state: PeerState,
  groupId: string,
  botId: string,
  join: BotGroupJoin,
  rules: PeerRules,
): PeerDecision<PeerJoined> {
  const group = requireGroup(state, groupId)
  const name = requireListed(rules, botId)
  const current = state.members.get(botId)
  const record: PeerMemberRecord = { groupId, role: join.role, joinedAt: rules.now }
  if (current?.groupId === groupId) {
    throw new Error(`${name} is already in group "${group.name}"`)
  }
  if (join.from === undefined) {
    if (current !== undefined) {
      const other = state.groups.get(current.groupId)
      throw new Error(`${name} is already in group "${other?.name ?? current.groupId}"`)
    }
    return { writes: [{ kind: "put-member", botId, record }], result: { groupId, withdrawn: [] } }
  }
  if (current?.groupId !== join.from) {
    const from = state.groups.get(join.from)
    throw new Error(`${name} is not in group "${from?.name ?? join.from}"`)
  }
  const withdrawn = withdrawals(state, involving(join.from, botId), "left-group")
  return {
    writes: [...putMessages(withdrawn), { kind: "put-member", botId, record }],
    result: { groupId, withdrawn },
  }
}

function requireMember(state: PeerState, botId: string, rules: PeerRules): PeerMemberRecord {
  const member = state.members.get(botId)
  if (member === undefined) throw new Error(`${botName(rules, botId)} is in no group`)
  return member
}

export function decideLeave(
  state: PeerState,
  botId: string,
  rules: PeerRules,
): PeerDecision<readonly PeerWithdrawn[]> {
  const member = requireMember(state, botId, rules)
  const withdrawn = withdrawals(state, involving(member.groupId, botId), "left-group")
  return {
    writes: [...putMessages(withdrawn), { kind: "delete-member", botId }],
    result: withdrawn,
  }
}

export function decideRole(
  state: PeerState,
  botId: string,
  role: string,
  rules: PeerRules,
): PeerDecision<string> {
  const member = requireMember(state, botId, rules)
  return {
    writes: [{ kind: "put-member", botId, record: { ...member, role } }],
    result: member.groupId,
  }
}

function withPause(group: PeerGroupRecord, paused: PeerGroupRecord["paused"]): PeerGroupRecord {
  const { paused: _paused, ...rest } = group
  return paused === undefined ? rest : { ...rest, paused }
}

export function decidePaused(
  state: PeerState,
  groupId: string,
  paused: boolean,
  rules: PeerRules,
): PeerDecision<string> {
  const group = requireGroup(state, groupId)
  if (paused === (group.paused !== undefined)) return { writes: [], result: groupId }
  return {
    writes: [
      {
        kind: "put-group",
        groupId,
        record: withPause(group, paused ? { reason: "owner", at: rules.now } : undefined),
      },
    ],
    result: groupId,
  }
}

export function decideLimitPause(
  state: PeerState,
  groupId: string,
  detail: BotPeerLimit,
  rules: PeerRules,
): PeerDecision<boolean> {
  const group = requireGroup(state, groupId)
  if (group.paused !== undefined) return { writes: [], result: false }
  return {
    writes: [
      {
        kind: "put-group",
        groupId,
        record: withPause(group, { reason: "limit", at: rules.now, detail }),
      },
    ],
    result: true,
  }
}

export function decideForgetBots(
  state: PeerState,
  exists: (botId: string) => boolean,
): PeerDecision<readonly PeerWithdrawn[]> {
  const gone = (message: PeerMessageRecord) => !exists(message.from) || !exists(message.to)
  const withdrawn = withdrawals(state, gone, "bot-deleted")
  return {
    writes: [
      ...[...state.members.keys()]
        .filter((botId) => !exists(botId))
        .map((botId): PeerWrite => ({ kind: "delete-member", botId })),
      ...[...state.messages]
        .filter(([, message]) => gone(message))
        .map(([messageId]): PeerWrite => ({ kind: "delete-message", messageId })),
    ],
    result: withdrawn,
  }
}

export interface PeerGroupsDeps {
  readonly store: PeerStore
  bot(botId: string): PeerBot
  newId(): string
  now(): number
}

export interface PeerGroups {
  state(): PeerState
  membership(botId: string): PeerMembership | undefined
  sharedGroup(botId: string, otherId: string): string | undefined
  create(input: BotGroupInput): Promise<string>
  update(groupId: string, change: BotGroupChange): Promise<string>
  deleteGroup(groupId: string): Promise<void>
  join(groupId: string, botId: string, join: BotGroupJoin): Promise<string>
  leave(botId: string): Promise<void>
  setRole(botId: string, role: string): Promise<string>
  setPaused(groupId: string, paused: boolean): Promise<string>
  pauseForLimit(groupId: string, detail: BotPeerLimit): Promise<boolean>
  forgetBots(exists: (botId: string) => boolean): Promise<void>
  onWithdrawn(listener: (withdrawn: readonly PeerWithdrawn[]) => void): () => void
  subscribe(listener: () => void): () => void
}

export function createPeerGroups(deps: PeerGroupsDeps): PeerGroups {
  const { store } = deps
  const withdrawnListeners = new Set<(withdrawn: readonly PeerWithdrawn[]) => void>()
  const rules = (): PeerRules => ({ bot: (botId) => deps.bot(botId), now: deps.now() })
  const tell = (withdrawn: readonly PeerWithdrawn[]) => {
    if (withdrawn.length === 0) return
    for (const listener of [...withdrawnListeners]) listener(withdrawn)
  }
  return {
    state: () => store.state(),
    membership: (botId) => membershipOf(store.state(), botId),
    sharedGroup: (botId, otherId) => sharedGroupOf(store.state(), botId, otherId),
    create(input) {
      const groupId = deps.newId()
      return store.change((state) => decideCreate(state, groupId, input, rules()))
    },
    update: (groupId, change) => store.change((state) => decideUpdate(state, groupId, change)),
    async deleteGroup(groupId) {
      tell(await store.change((state) => decideDelete(state, groupId)))
    },
    async join(groupId, botId, join) {
      const joined = await store.change((state) => decideJoin(state, groupId, botId, join, rules()))
      tell(joined.withdrawn)
      return joined.groupId
    },
    async leave(botId) {
      tell(await store.change((state) => decideLeave(state, botId, rules())))
    },
    setRole: (botId, role) => store.change((state) => decideRole(state, botId, role, rules())),
    setPaused: (groupId, paused) =>
      store.change((state) => decidePaused(state, groupId, paused, rules())),
    pauseForLimit: (groupId, detail) =>
      store.change((state) => decideLimitPause(state, groupId, detail, rules())),
    async forgetBots(exists) {
      tell(await store.change((state) => decideForgetBots(state, exists)))
    },
    onWithdrawn(listener) {
      withdrawnListeners.add(listener)
      return () => {
        withdrawnListeners.delete(listener)
      }
    },
    subscribe: (listener) => store.subscribe(listener),
  }
}
