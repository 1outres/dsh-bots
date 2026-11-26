import type { ConnectorDecisionOrigin } from "./connectors"

export type SenderUnknown = "allow" | "ask" | "deny"

export const SENDER_UNKNOWNS: readonly SenderUnknown[] = ["allow", "ask", "deny"]

export type SenderVerdict = "allow" | "deny"

export const SENDER_VERDICTS: readonly SenderVerdict[] = ["allow", "deny"]

export type SenderMatchKind = "address" | "domain"

export const SENDER_MATCH_KINDS: readonly SenderMatchKind[] = ["address", "domain"]

export interface SenderMatch {
  readonly kind: SenderMatchKind
  readonly value: string
}

export type SenderRuleOrigin = ConnectorDecisionOrigin

export interface SenderRule {
  readonly match: SenderMatch
  readonly verdict: SenderVerdict
  readonly decidedAt: number
  readonly origin: SenderRuleOrigin
}

export interface SenderPolicy {
  readonly unknown: SenderUnknown
  readonly rules: readonly SenderRule[]
}

export type SenderPolicyStart = "migrated" | "connected"

export const SENDER_POLICY_START: Readonly<Record<SenderPolicyStart, SenderUnknown>> = {
  migrated: "allow",
  connected: "ask",
}

export function startingSenderPolicy(start: SenderPolicyStart): SenderPolicy {
  return { unknown: SENDER_POLICY_START[start], rules: [] }
}

export type ConnectorSender =
  | { readonly kind: "self" }
  | { readonly kind: "external"; readonly address: string; readonly verified: boolean }
  | { readonly kind: "anonymous" }

export type SenderHiddenReason = "denied" | "unknown" | "unverified"

export const SENDER_HIDDEN_REASONS: readonly SenderHiddenReason[] = [
  "unknown",
  "unverified",
  "denied",
]

export type SenderJudgement =
  | { readonly visible: true; readonly basis: "self" | "rule" | "unknown" }
  | {
      readonly visible: false
      readonly reason: SenderHiddenReason
      readonly inquire: boolean
    }

const MAX_ADDRESS = 320
const MAX_DOMAIN = 253
const LOCAL_PART = /^[^\s@<>()",;:\\[\]\p{Cc}\p{Cf}]+$/u
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const WILDCARD = "*."

function hostnameOf(input: string): string | undefined {
  if (input === "" || input.length > MAX_DOMAIN || /[\s/?#@:\\[\]%]/u.test(input)) return undefined
  let hostname: string
  try {
    hostname = new URL(`http://${input}`).hostname
  } catch {
    return undefined
  }
  const labels = hostname.split(".")
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return undefined
  if (/^[0-9]+$/.test(labels.at(-1) ?? "")) return undefined
  return hostname
}

export function normalizeSenderDomain(input: string): string | undefined {
  return hostnameOf(input.trim().toLowerCase())
}

export function normalizeSenderAddress(input: string): string | undefined {
  const text = input.trim().toLowerCase()
  if (text.length > MAX_ADDRESS) return undefined
  const at = text.lastIndexOf("@")
  if (at <= 0) return undefined
  const local = text.slice(0, at)
  const domain = hostnameOf(text.slice(at + 1))
  if (!LOCAL_PART.test(local) || domain === undefined) return undefined
  return `${local}@${domain}`
}

export function senderDomainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1)
}

export type SenderMatchCheck =
  | { readonly ok: true; readonly match: SenderMatch }
  | { readonly ok: false; readonly problem: "address" | "domain" | "kind" }

export function checkSenderMatch(input: {
  readonly kind: unknown
  readonly value: unknown
}): SenderMatchCheck {
  if (typeof input.value !== "string") return { ok: false, problem: "kind" }
  if (input.kind === "address") {
    const address = normalizeSenderAddress(input.value)
    return address === undefined
      ? { ok: false, problem: "address" }
      : { ok: true, match: { kind: "address", value: address } }
  }
  if (input.kind === "domain") {
    const text = input.value.trim().toLowerCase()
    const wildcard = text.startsWith(WILDCARD)
    const domain = normalizeSenderDomain(wildcard ? text.slice(WILDCARD.length) : text)
    return domain === undefined
      ? { ok: false, problem: "domain" }
      : { ok: true, match: { kind: "domain", value: wildcard ? `${WILDCARD}${domain}` : domain } }
  }
  return { ok: false, problem: "kind" }
}

export function parseSenderMatch(input: unknown): SenderMatch {
  if (typeof input !== "object" || input === null) throw new Error("a sender match is an object")
  const checked = checkSenderMatch(input as { readonly kind: unknown; readonly value: unknown })
  if (checked.ok) return checked.match
  switch (checked.problem) {
    case "address":
      throw new Error("the sender address is not an email address")
    case "domain":
      throw new Error("the sender domain is not a domain (example.com or *.example.com)")
    case "kind":
      throw new Error("a sender match is an address or a domain")
  }
}

export function sameSenderMatch(a: SenderMatch, b: SenderMatch): boolean {
  return a.kind === b.kind && a.value === b.value
}

export function isWildcardDomain(match: SenderMatch): boolean {
  return match.kind === "domain" && match.value.startsWith(WILDCARD)
}

export function domainOfMatch(match: SenderMatch): string {
  if (match.kind === "address") return senderDomainOf(match.value)
  return isWildcardDomain(match) ? match.value.slice(WILDCARD.length) : match.value
}

function domainSpecificity(rule: SenderMatch, domain: string): number | undefined {
  if (rule.kind !== "domain") return undefined
  if (!isWildcardDomain(rule)) return rule.value === domain ? Number.MAX_SAFE_INTEGER : undefined
  const base = domainOfMatch(rule)
  return domain === base || domain.endsWith(`.${base}`) ? base.length : undefined
}

export function senderRuleFor(
  rules: readonly SenderRule[],
  address: string,
): SenderRule | undefined {
  const exact = rules.find((rule) => rule.match.kind === "address" && rule.match.value === address)
  if (exact !== undefined) return exact
  const domain = senderDomainOf(address)
  let best: { readonly rule: SenderRule; readonly specificity: number } | undefined
  for (const rule of rules) {
    const specificity = domainSpecificity(rule.match, domain)
    if (specificity === undefined) continue
    if (best === undefined || specificity > best.specificity) best = { rule, specificity }
  }
  return best?.rule
}

function unknownSender(policy: SenderPolicy, verified: boolean): SenderJudgement {
  switch (policy.unknown) {
    case "allow":
      return { visible: true, basis: "unknown" }
    case "ask":
      return verified
        ? { visible: false, reason: "unknown", inquire: true }
        : { visible: false, reason: "unverified", inquire: false }
    case "deny":
      return { visible: false, reason: verified ? "unknown" : "unverified", inquire: false }
  }
}

export function judgeSender(policy: SenderPolicy, sender: ConnectorSender): SenderJudgement {
  if (sender.kind === "self") return { visible: true, basis: "self" }
  if (sender.kind === "anonymous") return unknownSender(policy, false)
  const address = normalizeSenderAddress(sender.address)
  if (address === undefined) return unknownSender(policy, false)
  const rule = senderRuleFor(policy.rules, address)
  if (rule?.verdict === "deny") return { visible: false, reason: "denied", inquire: false }
  if (rule?.verdict === "allow" && sender.verified) return { visible: true, basis: "rule" }
  return unknownSender(policy, sender.verified && rule === undefined)
}

export type SenderHiddenTally = Readonly<Record<SenderHiddenReason, number>>

export function hiddenTally(reasons: readonly SenderHiddenReason[]): SenderHiddenTally {
  const tally: Record<SenderHiddenReason, number> = { unknown: 0, unverified: 0, denied: 0 }
  for (const reason of reasons) tally[reason] += 1
  return tally
}

const plural = (count: number, one: string, other: string) =>
  `${count} ${count === 1 ? one : other}`

const HIDDEN_PART: Readonly<Record<SenderHiddenReason, (count: number) => string>> = {
  unknown: (count) => `${count} from senders not allowed yet`,
  unverified: (count) => `${count} from senders that could not be verified`,
  denied: (count) => `${count} denied`,
}

export function senderHiddenNote(tally: SenderHiddenTally): string | undefined {
  const total = SENDER_HIDDEN_REASONS.reduce((sum, reason) => sum + tally[reason], 0)
  if (total === 0) return undefined
  const parts = SENDER_HIDDEN_REASONS.filter((reason) => tally[reason] > 0).map((reason) =>
    HIDDEN_PART[reason](tally[reason]),
  )
  const head = `${plural(total, "message", "messages")} hidden by the sender policy (${parts.join(", ")}).`
  return tally.unknown > 0
    ? `${head} The account's owner can allow senders in the bot's settings to let you read them.`
    : head
}

export function senderHiddenRefusal(item: string): string {
  return `${item} is hidden by the sender policy of this account`
}

export const FREEMAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.jp",
  "hotmail.com",
  "hotmail.co.jp",
  "live.com",
  "live.jp",
  "msn.com",
  "yahoo.com",
  "yahoo.co.jp",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "docomo.ne.jp",
  "ezweb.ne.jp",
  "au.com",
  "softbank.ne.jp",
  "i.softbank.jp",
]

export const FREEMAIL_FAMILIES: readonly string[] = ["gmx"]

export function isFreemailDomain(domain: string): boolean {
  if (FREEMAIL_DOMAINS.includes(domain)) return true
  const labels = domain.split(".")
  return labels.length >= 2 && FREEMAIL_FAMILIES.includes(labels.at(-2) ?? "")
}

export function coversFreemail(match: SenderMatch): boolean {
  if (match.kind !== "domain") return false
  const base = domainOfMatch(match)
  if (isFreemailDomain(base)) return true
  return isWildcardDomain(match) && FREEMAIL_DOMAINS.some((domain) => domain.endsWith(`.${base}`))
}

export type SenderChoice = "allow-address" | "allow-domain" | "deny-address" | "deny-domain"

export const SENDER_CHOICES: readonly SenderChoice[] = [
  "allow-address",
  "allow-domain",
  "deny-address",
  "deny-domain",
]

export function senderChoicesFor(address: string): readonly SenderChoice[] {
  return isFreemailDomain(senderDomainOf(address))
    ? SENDER_CHOICES.filter((choice) => choice !== "allow-domain")
    : SENDER_CHOICES
}

export function senderChoiceRule(
  choice: SenderChoice,
  address: string,
): { readonly match: SenderMatch; readonly verdict: SenderVerdict } {
  const verdict: SenderVerdict = choice.startsWith("allow") ? "allow" : "deny"
  const match: SenderMatch = choice.endsWith("domain")
    ? { kind: "domain", value: senderDomainOf(address) }
    : { kind: "address", value: address }
  return { match, verdict }
}

export type SenderInquiryStatus =
  | { readonly state: "pending" }
  | {
      readonly state: "answered"
      readonly choice: SenderChoice
      readonly origin: SenderRuleOrigin
      readonly at: number
    }
  | { readonly state: "covered"; readonly verdict: SenderVerdict; readonly at: number }
  | { readonly state: "expired"; readonly at: number }

export type SenderInquiryState = SenderInquiryStatus["state"]

export const SENDER_INQUIRY_STATES: readonly SenderInquiryState[] = [
  "pending",
  "answered",
  "covered",
  "expired",
]

export interface SenderInquiryView {
  readonly id: string
  readonly connectionId: string
  readonly account: string
  readonly connector: { readonly id: string; readonly name?: string }
  readonly address: string
  readonly domain: string
  readonly choices: readonly SenderChoice[]
  readonly waiting: number
  readonly samples: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt: number
  readonly status: SenderInquiryStatus
}

export const SENDER_INQUIRY_TTL_MS = 30 * 24 * 60 * 60_000

export interface SenderRuleChange {
  readonly match: SenderMatch
  readonly verdict: SenderVerdict
}

export interface SenderPolicyView {
  readonly connectionId: string
  readonly account: string
  readonly policy?: SenderPolicy
  readonly inquiries: readonly SenderInquiryView[]
}

export interface BotSendersSnapshot {
  readonly accounts: readonly SenderPolicyView[]
}

export interface BotSenderInquiriesSnapshot {
  readonly botId: string
  readonly inquiries: readonly SenderInquiryView[]
}

export interface SenderWaitingSnapshot {
  readonly waiting: Readonly<Record<string, number>>
}

export interface SenderRecipient {
  readonly address: string
  readonly name?: string
  readonly messages: number
}

export interface SenderRecipientsView {
  readonly connectionId: string
  readonly scanned: number
  readonly recipients: readonly SenderRecipient[]
}

export const MAX_SENDER_RECIPIENT_SCAN = 200

export type SenderAnswerRefusal =
  | "not-approver"
  | "not-found"
  | "settled"
  | "closed"
  | "not-offered"

export type SenderAnswerResult =
  | { readonly accepted: true; readonly inquiry: SenderInquiryView }
  | { readonly accepted: false; readonly reason: "settled"; readonly inquiry: SenderInquiryView }
  | { readonly accepted: false; readonly reason: Exclude<SenderAnswerRefusal, "settled"> }

export interface BotSendersApi {
  watch(signal?: AbortSignal): AsyncIterable<BotSendersSnapshot>
  setUnknown(connectionId: string, unknown: SenderUnknown): Promise<SenderPolicyView>
  putRules(connectionId: string, rules: readonly SenderRuleChange[]): Promise<SenderPolicyView>
  removeRule(connectionId: string, match: SenderMatch): Promise<SenderPolicyView>
  copy(fromConnectionId: string, toConnectionId: string): Promise<SenderPolicyView>
  recipients(
    connectorId: string,
    connectionId: string,
    signal?: AbortSignal,
  ): Promise<SenderRecipientsView>
  watchBot(botId: string, signal?: AbortSignal): AsyncIterable<BotSenderInquiriesSnapshot>
  watchWaiting(signal?: AbortSignal): AsyncIterable<SenderWaitingSnapshot>
  answer(inquiryId: string, choice: SenderChoice): Promise<SenderAnswerResult>
}
