import type { BotConnectorSenders, ConnectorEvent } from "../../connector-contract"
import type { ConnectorDecisionOrigin } from "../../shared/connectors"
import {
  type ConnectorSender,
  hiddenTally,
  judgeSender,
  normalizeSenderAddress,
  parseSenderMatch,
  SENDER_CHOICES,
  SENDER_INQUIRY_TTL_MS,
  SENDER_UNKNOWNS,
  SENDER_VERDICTS,
  type SenderAnswerResult,
  type SenderChoice,
  type SenderHiddenReason,
  type SenderInquiryStatus,
  type SenderInquiryView,
  type SenderMatch,
  type SenderPolicy,
  type SenderRule,
  type SenderRuleChange,
  type SenderUnknown,
  senderChoiceRule,
  senderChoicesFor,
  senderDomainOf,
  senderHiddenNote,
  senderHiddenRefusal,
} from "../../shared/senders"
import type { HeldEvent, SenderInquiryRecord } from "./domain"
import type { SenderStore } from "./store"

export interface SenderRelease {
  readonly connectionId: string
  readonly connectorId: string
  readonly events: readonly ConnectorEvent[]
  readonly gap?: string
}

export interface SenderPoliciesDeps {
  store: SenderStore
  release(release: SenderRelease): Promise<void>
  account(connectionId: string): string
  connectorName(connectorId: string): string | undefined
  newId(): string
  now(): number
  readonly maxHeld: number
  readonly closedRetentionMs: number
}

export interface SenderScreening {
  readonly deliver: readonly ConnectorEvent[]
  readonly held: number
  readonly dropped: number
}

export interface SenderPolicies {
  screen(
    connectionId: string,
    connectorId: string,
    events: readonly ConnectorEvent[],
  ): Promise<SenderScreening>
  senders(connectionId: string): BotConnectorSenders
  policy(connectionId: string): SenderPolicy | undefined
  setUnknown(connectionId: string, unknown: unknown): Promise<void>
  putRules(connectionId: string, rules: unknown, origin: ConnectorDecisionOrigin): Promise<void>
  removeRule(connectionId: string, match: unknown): Promise<void>
  copy(fromConnectionId: string, toConnectionId: string): Promise<void>
  answer(
    inquiryId: string,
    choice: unknown,
    origin: ConnectorDecisionOrigin,
  ): Promise<SenderAnswerResult>
  view(record: SenderInquiryRecord): SenderInquiryView
  inquiries(): readonly SenderInquiryRecord[]
  sweep(): Promise<void>
}

const SAMPLES = 3
const SAMPLE_CHARS = 200

function eventOf(held: HeldEvent): ConnectorEvent {
  return {
    key: held.key,
    kind: held.kind,
    occurredAt: held.occurredAt,
    summary: held.summary,
    ref: held.ref,
    sender: held.sender,
  }
}

function heldOf(event: ConnectorEvent, sender: ConnectorSender): HeldEvent {
  return {
    key: event.key,
    kind: event.kind,
    occurredAt: Math.max(0, Math.trunc(event.occurredAt)),
    summary: event.summary,
    ref: event.ref,
    sender,
  }
}

function parseRuleChanges(input: unknown): readonly SenderRuleChange[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("give at least one sender rule")
  }
  const changes: SenderRuleChange[] = []
  for (const item of input as unknown[]) {
    if (typeof item !== "object" || item === null) throw new Error("a sender rule is an object")
    const { match, verdict } = item as { readonly match?: unknown; readonly verdict?: unknown }
    if (!SENDER_VERDICTS.includes(verdict as never)) {
      throw new Error("a sender rule's verdict is allow or deny")
    }
    const parsed = parseSenderMatch(match)
    if (
      changes.some(
        (change) => change.match.kind === parsed.kind && change.match.value === parsed.value,
      )
    ) {
      throw new Error(`${parsed.value} is listed twice`)
    }
    changes.push({ match: parsed, verdict: verdict as SenderRuleChange["verdict"] })
  }
  return changes
}

export function createSenderPolicies(deps: SenderPoliciesDeps): SenderPolicies {
  const { store } = deps
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }

  const requirePolicy = (connectionId: string): SenderPolicy => {
    const policy = store.policy(connectionId)
    if (policy === undefined) {
      throw new Error(
        "this account has no sender policy yet; its owner chooses one in the bot's connector settings",
      )
    }
    return policy
  }

  const view = (record: SenderInquiryRecord): SenderInquiryView => {
    const name = deps.connectorName(record.connectorId)
    return {
      id: record.id,
      connectionId: record.connectionId,
      account: deps.account(record.connectionId),
      connector: { id: record.connectorId, ...(name === undefined ? {} : { name }) },
      address: record.address,
      domain: senderDomainOf(record.address),
      choices: senderChoicesFor(record.address),
      waiting: record.status.state === "pending" ? record.arrived : 0,
      samples:
        record.status.state === "pending"
          ? record.held
              .slice(-SAMPLES)
              .reverse()
              .map((held) => held.summary.slice(0, SAMPLE_CHARS))
          : [],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      expiresAt: record.expiresAt,
      status: record.status,
    }
  }

  const close = async (record: SenderInquiryRecord, status: SenderInquiryStatus) => {
    const released =
      status.state === "answered"
        ? status.choice.startsWith("allow")
        : status.state === "covered" && status.verdict === "allow"
    if (released && record.held.length > 0) {
      const missed = record.arrived - record.held.length
      await deps.release({
        connectionId: record.connectionId,
        connectorId: record.connectorId,
        events: record.held.map(eventOf),
        ...(missed > 0
          ? {
              gap: `${missed} older message(s) from ${record.address} arrived while waiting for the owner's decision and are not listed; search the mailbox for them`,
            }
          : {}),
      })
    }
    await store.putInquiry({
      ...record,
      held: [],
      updatedAt: deps.now(),
      status,
    })
  }

  const pendingOf = (connectionId: string) =>
    store
      .inquiries()
      .filter((record) => record.connectionId === connectionId && record.status.state === "pending")

  const settle = async (connectionId: string) => {
    const policy = store.policy(connectionId)
    if (policy === undefined) return
    for (const record of pendingOf(connectionId)) {
      const judgement = judgeSender(policy, {
        kind: "external",
        address: record.address,
        verified: true,
      })
      if (judgement.visible) {
        await close(record, { state: "covered", verdict: "allow", at: deps.now() })
      } else if (!judgement.inquire) {
        await close(record, { state: "covered", verdict: "deny", at: deps.now() })
      }
    }
  }

  const hold = async (
    connectionId: string,
    connectorId: string,
    address: string,
    events: readonly HeldEvent[],
  ) => {
    const now = deps.now()
    const open = pendingOf(connectionId).find(
      (record) => record.connectorId === connectorId && record.address === address,
    )
    const known = new Set(open?.held.map((held) => held.key) ?? [])
    const fresh = events.filter((held) => !known.has(held.key))
    if (open !== undefined && fresh.length === 0) return
    const held = [...(open?.held ?? []), ...fresh].slice(-deps.maxHeld)
    await store.putInquiry({
      id: open?.id ?? deps.newId(),
      connectionId,
      connectorId,
      address,
      held,
      arrived: (open?.arrived ?? 0) + fresh.length,
      createdAt: open?.createdAt ?? now,
      updatedAt: now,
      expiresAt: open?.expiresAt ?? now + SENDER_INQUIRY_TTL_MS,
      status: { state: "pending" },
    })
  }

  const parseUnknown = (input: unknown): SenderUnknown => {
    if (!SENDER_UNKNOWNS.includes(input as never)) {
      throw new Error(`unknown senders are one of ${SENDER_UNKNOWNS.join(", ")}`)
    }
    return input as SenderUnknown
  }

  return {
    screen: (connectionId, connectorId, events) =>
      serial(async () => {
        const policy = requirePolicy(connectionId)
        const deliver: ConnectorEvent[] = []
        const holding = new Map<string, HeldEvent[]>()
        let dropped = 0
        for (const event of events) {
          if (event.own === true) {
            deliver.push(event)
            continue
          }
          const sender = event.sender
          if (sender === undefined) throw new Error(`event "${event.key}" names no sender`)
          const judgement = judgeSender(policy, sender)
          if (judgement.visible) {
            deliver.push(event)
            continue
          }
          const address =
            sender.kind === "external" ? normalizeSenderAddress(sender.address) : undefined
          if (!judgement.inquire || address === undefined) {
            dropped += 1
            continue
          }
          const list = holding.get(address) ?? []
          list.push(heldOf(event, { kind: "external", address, verified: true }))
          holding.set(address, list)
        }
        for (const [address, held] of holding) await hold(connectionId, connectorId, address, held)
        return {
          deliver,
          held: [...holding.values()].reduce((sum, list) => sum + list.length, 0),
          dropped,
        }
      }),
    senders(connectionId) {
      const judge = (sender: ConnectorSender) => judgeSender(requirePolicy(connectionId), sender)
      return {
        screen() {
          const policy = requirePolicy(connectionId)
          const hidden: SenderHiddenReason[] = []
          return {
            admits(sender) {
              const judgement = judgeSender(policy, sender)
              if (judgement.visible) return true
              hidden.push(judgement.reason)
              return false
            },
            note: () => senderHiddenNote(hiddenTally(hidden)),
          }
        },
        require(sender, item) {
          if (!judge(sender).visible) throw new Error(senderHiddenRefusal(item))
        },
      }
    },
    policy: (connectionId) => store.policy(connectionId),
    setUnknown: (connectionId, input) =>
      serial(async () => {
        await store.setUnknown(connectionId, parseUnknown(input))
        await settle(connectionId)
      }),
    putRules: (connectionId, input, origin) =>
      serial(async () => {
        requirePolicy(connectionId)
        const at = deps.now()
        const rules: SenderRule[] = parseRuleChanges(input).map((change) => ({
          ...change,
          decidedAt: at,
          origin,
        }))
        await store.putRules(connectionId, rules)
        await settle(connectionId)
      }),
    removeRule: (connectionId, input) =>
      serial(async () => {
        requirePolicy(connectionId)
        const match: SenderMatch = parseSenderMatch(input)
        await store.removeRule(connectionId, match)
        await settle(connectionId)
      }),
    copy: (fromConnectionId, toConnectionId) =>
      serial(async () => {
        if (fromConnectionId === toConnectionId) throw new Error("copy to another account")
        const policy = requirePolicy(fromConnectionId)
        await store.replace(toConnectionId, policy)
        await settle(toConnectionId)
      }),
    answer: (inquiryId, input, origin) =>
      serial(async (): Promise<SenderAnswerResult> => {
        const record = store.inquiry(inquiryId)
        if (record === undefined) return { accepted: false, reason: "not-found" }
        if (record.status.state !== "pending") {
          return { accepted: false, reason: "settled", inquiry: view(record) }
        }
        if (!SENDER_CHOICES.includes(input as never)) {
          throw new Error(`a sender answer is one of ${SENDER_CHOICES.join(", ")}`)
        }
        const choice = input as SenderChoice
        if (!senderChoicesFor(record.address).includes(choice)) {
          return { accepted: false, reason: "not-offered" }
        }
        requirePolicy(record.connectionId)
        const at = deps.now()
        await store.putRules(record.connectionId, [
          { ...senderChoiceRule(choice, record.address), decidedAt: at, origin },
        ])
        await close(record, { state: "answered", choice, origin, at })
        await settle(record.connectionId)
        const answered = store.inquiry(inquiryId) ?? record
        return { accepted: true, inquiry: view(answered) }
      }),
    view,
    inquiries: () => store.inquiries(),
    sweep: () =>
      serial(async () => {
        const now = deps.now()
        for (const record of store.inquiries()) {
          if (record.status.state === "pending") {
            if (record.expiresAt <= now) await close(record, { state: "expired", at: now })
          } else if (now - record.updatedAt > deps.closedRetentionMs) {
            await store.deleteInquiry(record.id)
          }
        }
      }),
  }
}
