import {
  type SenderMatch,
  type SenderPolicy,
  type SenderPolicyStart,
  type SenderRule,
  type SenderUnknown,
  sameSenderMatch,
  startingSenderPolicy,
} from "../../shared/senders"
import type { BotTable } from "../registry"
import {
  SENDER_MIGRATION_KEY,
  type SenderInquiryRecord,
  type SenderMigrationRecord,
  type SenderPolicyRecord,
} from "./domain"

export interface SenderStoreDeps {
  senderPolicies: BotTable<SenderPolicyRecord>
  senderInquiries: BotTable<SenderInquiryRecord>
  senderMigrations: BotTable<SenderMigrationRecord>
  now(): number
}

export interface SenderStore {
  migrate(existing: readonly string[]): Promise<void>
  start(connectionId: string, start: SenderPolicyStart): Promise<void>
  policy(connectionId: string): SenderPolicy | undefined
  policies(): readonly SenderPolicyRecord[]
  setUnknown(connectionId: string, unknown: SenderUnknown): Promise<void>
  putRules(connectionId: string, rules: readonly SenderRule[]): Promise<void>
  removeRule(connectionId: string, match: SenderMatch): Promise<void>
  replace(connectionId: string, policy: SenderPolicy): Promise<void>
  inquiry(inquiryId: string): SenderInquiryRecord | undefined
  inquiries(): readonly SenderInquiryRecord[]
  putInquiry(record: SenderInquiryRecord): Promise<void>
  deleteInquiry(inquiryId: string): Promise<void>
  purge(keep: (connectionId: string) => boolean): Promise<void>
  forget(connectionId: string): Promise<void>
  subscribe(listener: () => void): () => void
}

export function createSenderStore(deps: SenderStoreDeps): SenderStore {
  const listeners = new Set<() => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const write = async (work: () => Promise<unknown>) => {
    await serial(work)
    for (const listener of [...listeners]) listener()
  }
  const recordOf = (connectionId: string, policy: SenderPolicy): SenderPolicyRecord => ({
    connectionId,
    unknown: policy.unknown,
    rules: policy.rules.map((rule) => ({
      match: { ...rule.match },
      verdict: rule.verdict,
      decidedAt: rule.decidedAt,
      origin: { ...rule.origin },
    })),
    updatedAt: deps.now(),
  })
  const require = (connectionId: string) => {
    const record = deps.senderPolicies.get(connectionId)
    if (record === undefined) throw new Error(`account "${connectionId}" has no sender policy`)
    return record
  }
  const save = (connectionId: string, policy: SenderPolicy) =>
    deps.senderPolicies.put(connectionId, recordOf(connectionId, policy))

  return {
    migrate: (existing) =>
      write(async () => {
        if (deps.senderMigrations.get(SENDER_MIGRATION_KEY) !== undefined) return
        for (const connectionId of existing) {
          if (deps.senderPolicies.get(connectionId) !== undefined) continue
          await save(connectionId, startingSenderPolicy("migrated"))
        }
        await deps.senderMigrations.put(SENDER_MIGRATION_KEY, {
          connections: [...existing],
          at: deps.now(),
        })
      }),
    start: (connectionId, start) =>
      write(async () => {
        if (deps.senderMigrations.get(SENDER_MIGRATION_KEY) === undefined) {
          throw new Error("the sender policies of the existing accounts are not migrated yet")
        }
        if (deps.senderPolicies.get(connectionId) !== undefined) return
        await save(connectionId, startingSenderPolicy(start))
      }),
    policy(connectionId) {
      const record = deps.senderPolicies.get(connectionId)
      return record === undefined ? undefined : { unknown: record.unknown, rules: record.rules }
    },
    policies: () => [...deps.senderPolicies.entries()].map(([, record]) => record),
    setUnknown: (connectionId, unknown) =>
      write(async () => {
        const current = deps.senderPolicies.get(connectionId)
        await save(connectionId, { unknown, rules: current?.rules ?? [] })
      }),
    putRules: (connectionId, rules) =>
      write(async () => {
        const current = require(connectionId)
        const kept = current.rules.filter(
          (existing) => !rules.some((rule) => sameSenderMatch(rule.match, existing.match)),
        )
        await save(connectionId, { unknown: current.unknown, rules: [...kept, ...rules] })
      }),
    removeRule: (connectionId, match) =>
      write(async () => {
        const current = require(connectionId)
        await save(connectionId, {
          unknown: current.unknown,
          rules: current.rules.filter((rule) => !sameSenderMatch(rule.match, match)),
        })
      }),
    replace: (connectionId, policy) => write(() => save(connectionId, policy)),
    inquiry: (inquiryId) => deps.senderInquiries.get(inquiryId),
    inquiries: () => [...deps.senderInquiries.entries()].map(([, record]) => record),
    putInquiry: (record) => write(() => deps.senderInquiries.put(record.id, record)),
    deleteInquiry: (inquiryId) =>
      write(async () => {
        await deps.senderInquiries.delete(inquiryId)
      }),
    purge: (keep) =>
      write(async () => {
        for (const [connectionId] of [...deps.senderPolicies.entries()]) {
          if (!keep(connectionId)) await deps.senderPolicies.delete(connectionId)
        }
        for (const [id, record] of [...deps.senderInquiries.entries()]) {
          if (!keep(record.connectionId)) await deps.senderInquiries.delete(id)
        }
      }),
    forget: (connectionId) =>
      write(async () => {
        await deps.senderPolicies.delete(connectionId)
        for (const [id, record] of [...deps.senderInquiries.entries()]) {
          if (record.connectionId === connectionId) await deps.senderInquiries.delete(id)
        }
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
