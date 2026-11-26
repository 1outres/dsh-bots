import type { SenderAnswerResult, SenderInquiryView } from "../../shared/senders"
import type { RemoteCaller } from "../connectors/approvals"
import type { SenderInquiryRecord } from "./domain"
import type { SenderPolicies } from "./policies"
import type { SenderStore } from "./store"

export interface AnsweringChannel {
  readonly id: string
  readonly name: string
  readonly approvers: ReadonlySet<string>
  readonly signal: AbortSignal
}

export interface SenderAnswersDeps {
  policies: Pick<SenderPolicies, "answer" | "view" | "inquiries">
  store: Pick<SenderStore, "subscribe">
  bots(): readonly string[]
  sees(botId: string, record: SenderInquiryRecord): boolean
}

export type SenderPendingResult =
  | { readonly ok: true; readonly inquiries: readonly SenderInquiryView[] }
  | { readonly ok: false; readonly reason: "not-approver" | "closed" }

export interface SenderAnswers {
  views(botId: string): readonly SenderInquiryView[]
  open(botId: string): readonly SenderInquiryView[]
  find(botId: string, inquiryId: string): SenderInquiryView | undefined
  pendingFor(botId: string, channel: AnsweringChannel, person: string): SenderPendingResult
  waiting(): Readonly<Record<string, number>>
  fromWeb(
    caller: RemoteCaller | undefined,
    inquiryId: string,
    choice: unknown,
  ): Promise<SenderAnswerResult>
  fromChannel(
    botId: string,
    channel: AnsweringChannel,
    person: string,
    inquiryId: string,
    choice: unknown,
  ): Promise<SenderAnswerResult>
  subscribe(listener: (inquiry: SenderInquiryView, botIds: readonly string[]) => void): () => void
}

const signature = (record: SenderInquiryRecord) => `${record.updatedAt}:${record.status.state}`

export function createSenderAnswers(deps: SenderAnswersDeps): SenderAnswers {
  const seen = (botId: string) =>
    deps.policies
      .inquiries()
      .filter((record) => deps.sees(botId, record))
      .sort((a, b) => a.createdAt - b.createdAt)
  const pending = (botId: string) =>
    seen(botId)
      .filter((record) => record.status.state === "pending")
      .map(deps.policies.view)

  return {
    views: (botId) => seen(botId).map(deps.policies.view),
    open: pending,
    find(botId, inquiryId) {
      const record = seen(botId).find((item) => item.id === inquiryId)
      return record === undefined ? undefined : deps.policies.view(record)
    },
    pendingFor(botId, channel, person) {
      if (channel.signal.aborted) return { ok: false, reason: "closed" }
      if (!channel.approvers.has(person)) return { ok: false, reason: "not-approver" }
      return { ok: true, inquiries: pending(botId) }
    },
    waiting() {
      const counts: Record<string, number> = {}
      for (const botId of deps.bots()) {
        const count = pending(botId).length
        if (count > 0) counts[botId] = count
      }
      return counts
    },
    async fromWeb(caller, inquiryId, choice) {
      if (caller?.kind !== "owner") return { accepted: false, reason: "not-approver" }
      return deps.policies.answer(inquiryId, choice, { kind: "web" })
    },
    async fromChannel(botId, channel, person, inquiryId, choice) {
      if (channel.signal.aborted) return { accepted: false, reason: "closed" }
      if (!channel.approvers.has(person)) return { accepted: false, reason: "not-approver" }
      const record = deps.policies.inquiries().find((item) => item.id === inquiryId)
      if (record === undefined || !deps.sees(botId, record)) {
        return { accepted: false, reason: "not-found" }
      }
      return deps.policies.answer(inquiryId, choice, {
        kind: "channel",
        channelId: channel.id,
        channelName: channel.name,
        person,
      })
    },
    subscribe(listener) {
      const known = new Map(
        deps.policies.inquiries().map((record) => [record.id, signature(record)]),
      )
      return deps.store.subscribe(() => {
        const current = deps.policies.inquiries()
        for (const record of current) {
          const mark = signature(record)
          if (known.get(record.id) === mark) continue
          known.set(record.id, mark)
          const bots = deps.bots().filter((botId) => deps.sees(botId, record))
          listener(deps.policies.view(record), bots)
        }
        const ids = new Set(current.map((record) => record.id))
        for (const id of [...known.keys()]) if (!ids.has(id)) known.delete(id)
      })
    },
  }
}
