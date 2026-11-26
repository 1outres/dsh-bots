import type { ConnectorText } from "./connectors"

export type VaultSecretKind = "password" | "otp" | "passkey"

export type VaultFieldKind = "username" | VaultSecretKind

export const VAULT_SECRET_KINDS: readonly VaultSecretKind[] = ["password", "otp", "passkey"]
export const VAULT_FIELD_KINDS: readonly VaultFieldKind[] = ["username", ...VAULT_SECRET_KINDS]

export type VaultRevealKind = "username" | "password" | "otp"

export const VAULT_REVEAL_KINDS: readonly VaultRevealKind[] = ["username", "password", "otp"]

export const GUARDED_KINDS: readonly VaultSecretKind[] = ["password", "passkey"]

export interface VaultSetupField {
  readonly key: string
  readonly label: ConnectorText
  readonly kind: "secret" | "text" | "url"
  readonly required: boolean
  readonly help?: ConnectorText
}

export type VaultProviderStatus =
  | { readonly state: "ready" }
  | { readonly state: "preparing"; readonly step?: string }
  | { readonly state: "failed"; readonly reason: string }

export interface VaultSite {
  readonly origin: string
  readonly subdomains: boolean
}

export interface VaultProviderView {
  readonly id: string
  readonly name: string
  readonly guide?: string
  readonly setup: readonly VaultSetupField[]
  readonly kinds: readonly VaultSecretKind[]
  readonly status: VaultProviderStatus
  readonly development: boolean
}

export type VaultAccountStatus = "active" | "error"

export const VAULT_ACCOUNT_STATUSES: readonly VaultAccountStatus[] = ["active", "error"]

export interface VaultAccountView {
  readonly id: string
  readonly provider: string
  readonly label: string
  readonly subject: string
  readonly status: VaultAccountStatus
  readonly statusReason?: string
  readonly createdAt: number
  readonly bots: readonly string[]
}

export interface VaultFillerView {
  readonly id: string
  readonly name: string
}

export interface BotVaultsSnapshot {
  readonly providers: readonly VaultProviderView[]
  readonly accounts: readonly VaultAccountView[]
  readonly fillers: readonly VaultFillerView[]
  readonly openIncidents: Readonly<Record<string, number>>
}

export interface VaultItemView {
  readonly accountId: string
  readonly vaultId: string
  readonly itemId: string
  readonly vaultName: string
  readonly title: string
  readonly username?: string
  readonly websites: readonly string[]
  readonly kinds: readonly VaultFieldKind[]
  readonly updatedAt?: number
}

export type VaultGrantAvailability = "available" | "missing" | "unchecked"

export interface VaultGuardState {
  readonly kind: VaultSecretKind
  readonly state: "fingerprinted" | "short" | "stale"
  readonly at: number
}

export interface VaultGrantView {
  readonly id: string
  readonly botId: string
  readonly accountId: string
  readonly vaultId: string
  readonly itemId: string
  readonly label: string
  readonly kinds: readonly VaultFieldKind[]
  readonly sites: readonly VaultSite[]
  readonly desktop: boolean
  readonly showUsername: boolean
  readonly connectors: readonly string[]
  readonly grantedAt: number
  readonly availability: VaultGrantAvailability
  readonly guard: readonly VaultGuardState[]
  readonly lastUsedAt?: number
}

export type VaultUseTarget =
  | { readonly kind: "browser"; readonly origin: string }
  | { readonly kind: "desktop"; readonly application: string }

export interface VaultUseView {
  readonly id: string
  readonly botId: string
  readonly grantId: string
  readonly kind: VaultFieldKind
  readonly connector: string
  readonly tool: string
  readonly sessionId?: string
  readonly target: VaultUseTarget
  readonly at: number
  readonly outcome: "filled" | "refused"
  readonly reason?: string
}

export type VaultIncidentSource =
  | "tool-result"
  | "tool-arguments"
  | "assistant-message"
  | "inbound-message"
  | "bot-context"

export type VaultIncidentOutcome = "redacted" | "exposed"

export interface VaultIncidentView {
  readonly id: string
  readonly botId: string
  readonly sessionId?: string
  readonly at: number
  readonly source: VaultIncidentSource
  readonly tool?: string
  readonly grantId: string
  readonly label: string
  readonly kind: VaultSecretKind
  readonly outcome: VaultIncidentOutcome
  readonly acknowledgedAt?: number
  readonly repeats?: number
  readonly lastAt?: number
}

export interface BotVaultView {
  readonly botId: string
  readonly grants: readonly VaultGrantView[]
  readonly uses: readonly VaultUseView[]
  readonly incidents: readonly VaultIncidentView[]
}

export interface VaultAccountRequest {
  readonly provider: string
  readonly label: string
  readonly values: Readonly<Record<string, string>>
}

export interface VaultGrantRequest {
  readonly accountId: string
  readonly vaultId: string
  readonly itemId: string
  readonly label?: string
  readonly kinds: readonly VaultFieldKind[]
  readonly connectors: readonly string[]
  readonly sites?: readonly VaultSite[]
  readonly desktop?: boolean
  readonly showUsername?: boolean
}

export interface VaultGrantChange {
  readonly label?: string
  readonly kinds?: readonly VaultFieldKind[]
  readonly connectors?: readonly string[]
  readonly sites?: readonly VaultSite[]
  readonly desktop?: boolean
  readonly showUsername?: boolean
}

export interface BotVaultsApi {
  watch(signal?: AbortSignal): AsyncIterable<BotVaultsSnapshot>
  addAccount(request: VaultAccountRequest): Promise<VaultAccountView>
  renameAccount(accountId: string, label: string): Promise<VaultAccountView>
  removeAccount(accountId: string): Promise<{ readonly removedGrants: number }>
  listItems(accountId: string, query: string): Promise<readonly VaultItemView[]>
  watchBot(botId: string, signal?: AbortSignal): AsyncIterable<BotVaultView>
  grant(botId: string, request: VaultGrantRequest): Promise<VaultGrantView>
  updateGrant(botId: string, grantId: string, change: VaultGrantChange): Promise<VaultGrantView>
  revoke(botId: string, grantId: string): Promise<{ readonly revoked: true }>
  acknowledgeIncident(botId: string, incidentId: string): Promise<VaultIncidentView>
}

export const MIN_GUARDED_LENGTH = 6

export const MAX_VAULT_LABEL = 60
export const MAX_VAULT_CONNECTORS = 20

const CONNECTOR_ID = /^[a-z][a-z0-9_]*$/

export function connectorsProblem(connectors: readonly string[]): string | undefined {
  if (connectors.length === 0) return "choose at least one connector that may fill it"
  if (connectors.length > MAX_VAULT_CONNECTORS) return `at most ${MAX_VAULT_CONNECTORS} connectors`
  if (connectors.some((id) => !CONNECTOR_ID.test(id))) return "a connector id is malformed"
  if (new Set(connectors).size !== connectors.length) return "a connector is listed twice"
  return undefined
}

export const isCredentialHandle = (value: unknown): value is string =>
  typeof value === "string" && /^cred-[0-9a-f]{6,32}$/.test(value)
export const MAX_VAULT_SITES = 20

export function vaultLabelProblem(label: string): string | undefined {
  const trimmed = label.trim()
  if (trimmed === "") return "the name is empty"
  if (trimmed.length > MAX_VAULT_LABEL)
    return `the name is longer than ${MAX_VAULT_LABEL} characters`
  if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) return "the name has control characters"
  return undefined
}

export function originOf(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined
  if (parsed.username !== "" || parsed.password !== "") return undefined
  return parsed.origin
}

export function defaultSites(websites: readonly string[]): readonly VaultSite[] {
  const origins = new Set<string>()
  for (const website of websites) {
    const origin = originOf(website)
    if (origin?.startsWith("https://")) origins.add(origin)
  }
  return [...origins].map((origin) => ({ origin, subdomains: false }))
}

export function siteMatches(sites: readonly VaultSite[], origin: string): boolean {
  let frame: URL
  try {
    frame = new URL(origin)
  } catch {
    return false
  }
  if (frame.origin !== origin) return false
  return sites.some((site) => {
    if (site.origin === origin) return true
    if (!site.subdomains) return false
    const allowed = new URL(site.origin)
    return (
      allowed.protocol === "https:" &&
      frame.protocol === allowed.protocol &&
      frame.port === allowed.port &&
      frame.hostname.endsWith(`.${allowed.hostname}`)
    )
  })
}

export function rpIdAllowed(rpId: string, origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return false
  }
  if (rpId === host) return true
  return rpId.includes(".") && host.endsWith(`.${rpId}`)
}

export function sitesProblem(sites: readonly VaultSite[]): string | undefined {
  if (sites.length > MAX_VAULT_SITES) return `at most ${MAX_VAULT_SITES} sites`
  const seen = new Set<string>()
  for (const site of sites) {
    const origin = originOf(site.origin)
    if (origin === undefined || origin !== site.origin) {
      return `"${site.origin}" is not an http(s) origin such as https://example.com`
    }
    if (site.subdomains && !origin.startsWith("https://")) {
      return `only an https site may include its subdomains (${origin})`
    }
    if (seen.has(origin)) return `${origin} is listed twice`
    seen.add(origin)
  }
  return undefined
}
