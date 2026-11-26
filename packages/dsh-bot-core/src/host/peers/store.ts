import type { BotTable } from "../registry"
import type { PeerGroupRecord, PeerMemberRecord, PeerMessageRecord } from "./domain"

export interface PeerState {
  readonly groups: ReadonlyMap<string, PeerGroupRecord>
  readonly members: ReadonlyMap<string, PeerMemberRecord>
  readonly messages: ReadonlyMap<string, PeerMessageRecord>
}

export type PeerWrite =
  | { readonly kind: "put-group"; readonly groupId: string; readonly record: PeerGroupRecord }
  | { readonly kind: "delete-group"; readonly groupId: string }
  | { readonly kind: "put-member"; readonly botId: string; readonly record: PeerMemberRecord }
  | { readonly kind: "delete-member"; readonly botId: string }
  | {
      readonly kind: "put-message"
      readonly messageId: string
      readonly record: PeerMessageRecord
    }
  | { readonly kind: "delete-message"; readonly messageId: string }

export interface PeerDecision<T> {
  readonly writes: readonly PeerWrite[]
  readonly result: T
}

export interface PeerStoreDeps {
  readonly peerGroups: BotTable<PeerGroupRecord>
  readonly peerMembers: BotTable<PeerMemberRecord>
  readonly peerMessages: BotTable<PeerMessageRecord>
  readonly keptMessages: number
}

export interface PeerStore {
  state(): PeerState
  change<T>(decide: (state: PeerState) => PeerDecision<T>): Promise<T>
  repair(): Promise<void>
  subscribe(listener: () => void): () => void
}

interface DraftState {
  readonly groups: Map<string, PeerGroupRecord>
  readonly members: Map<string, PeerMemberRecord>
  readonly messages: Map<string, PeerMessageRecord>
}

const oldestFirst = (
  [leftId, left]: readonly [string, PeerMessageRecord],
  [rightId, right]: readonly [string, PeerMessageRecord],
) => left.sentAt - right.sentAt || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)

function apply(draft: DraftState, write: PeerWrite): void {
  switch (write.kind) {
    case "put-group":
      draft.groups.set(write.groupId, write.record)
      return
    case "delete-group":
      draft.groups.delete(write.groupId)
      for (const [botId, member] of [...draft.members]) {
        if (member.groupId === write.groupId) draft.members.delete(botId)
      }
      for (const [messageId, message] of [...draft.messages]) {
        if (message.groupId === write.groupId) draft.messages.delete(messageId)
      }
      return
    case "put-member":
      draft.members.set(write.botId, write.record)
      return
    case "delete-member":
      draft.members.delete(write.botId)
      return
    case "put-message":
      draft.messages.set(write.messageId, write.record)
      return
    case "delete-message":
      draft.messages.delete(write.messageId)
      return
  }
}

function check(draft: DraftState, writes: readonly PeerWrite[]): void {
  for (const write of writes) {
    if (write.kind === "put-member" && !draft.groups.has(write.record.groupId)) {
      throw new Error(
        `bot "${write.botId}" cannot join group "${write.record.groupId}", which does not exist`,
      )
    }
    if (write.kind === "put-message" && !draft.groups.has(write.record.groupId)) {
      throw new Error(
        `message "${write.messageId}" belongs to group "${write.record.groupId}", which does not exist`,
      )
    }
  }
}

function trim(draft: DraftState, kept: number): void {
  const byGroup = new Map<string, [string, PeerMessageRecord][]>()
  for (const entry of draft.messages) {
    const list = byGroup.get(entry[1].groupId) ?? []
    list.push(entry)
    byGroup.set(entry[1].groupId, list)
  }
  for (const list of byGroup.values()) {
    if (list.length <= kept) continue
    for (const [messageId] of list.sort(oldestFirst).slice(0, list.length - kept)) {
      draft.messages.delete(messageId)
    }
  }
}

function orphans(draft: DraftState): void {
  for (const [botId, member] of [...draft.members]) {
    if (!draft.groups.has(member.groupId)) draft.members.delete(botId)
  }
  for (const [messageId, message] of [...draft.messages]) {
    if (!draft.groups.has(message.groupId)) draft.messages.delete(messageId)
  }
}

interface Diff<V> {
  readonly puts: readonly (readonly [string, V])[]
  readonly deletes: readonly string[]
}

function diff<V>(before: ReadonlyMap<string, V>, after: ReadonlyMap<string, V>): Diff<V> {
  return {
    puts: [...after].filter(([key, value]) => before.get(key) !== value),
    deletes: [...before.keys()].filter((key) => !after.has(key)),
  }
}

const empty = (change: Diff<unknown>) => change.puts.length === 0 && change.deletes.length === 0

export function createPeerStore(deps: PeerStoreDeps): PeerStore {
  const listeners = new Set<() => void>()
  let chain: Promise<unknown> = Promise.resolve()
  let cached: PeerState | undefined
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const state = (): PeerState => {
    cached ??= {
      groups: new Map(deps.peerGroups.entries()),
      members: new Map(deps.peerMembers.entries()),
      messages: new Map(deps.peerMessages.entries()),
    }
    return cached
  }
  const draftOf = (current: PeerState): DraftState => ({
    groups: new Map(current.groups),
    members: new Map(current.members),
    messages: new Map(current.messages),
  })
  const commit = async (current: PeerState, next: DraftState) => {
    const groups = diff(current.groups, next.groups)
    const members = diff(current.members, next.members)
    const messages = diff(current.messages, next.messages)
    if (empty(groups) && empty(members) && empty(messages)) return false
    try {
      for (const [groupId, record] of groups.puts) await deps.peerGroups.put(groupId, record)
      for (const [botId, record] of members.puts) await deps.peerMembers.put(botId, record)
      for (const [messageId, record] of messages.puts) {
        await deps.peerMessages.put(messageId, record)
      }
      for (const messageId of messages.deletes) await deps.peerMessages.delete(messageId)
      for (const botId of members.deletes) await deps.peerMembers.delete(botId)
      for (const groupId of groups.deletes) await deps.peerGroups.delete(groupId)
    } finally {
      cached = undefined
    }
    return true
  }
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    state,
    async change(decide) {
      const { result, wrote } = await serial(async () => {
        const current = state()
        const decision = decide(current)
        const next = draftOf(current)
        for (const write of decision.writes) apply(next, write)
        check(next, decision.writes)
        trim(next, deps.keptMessages)
        return { result: decision.result, wrote: await commit(current, next) }
      })
      if (wrote) notify()
      return result
    },
    async repair() {
      const wrote = await serial(async () => {
        const current = state()
        const next = draftOf(current)
        orphans(next)
        trim(next, deps.keptMessages)
        return commit(current, next)
      })
      if (wrote) notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
