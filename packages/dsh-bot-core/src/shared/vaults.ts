/**
 * Vaults' wire shapes shared by the Host and the browser
 * (docs/specs/bot-vaults.md): password managers the owner connects, the
 * logins (grants) each bot may use, their uses and the incidents of the
 * leak guard, and the `botVaults` Remote. No shape here ever holds a secret.
 */
import type { ConnectorText } from "./connectors"

/** A secret a provider can hand out. */
export type VaultSecretKind = "password" | "otp" | "passkey"

/** A field of a login; the username is not a secret. */
export type VaultFieldKind = "username" | VaultSecretKind

export const VAULT_SECRET_KINDS: readonly VaultSecretKind[] = ["password", "otp", "passkey"]
export const VAULT_FIELD_KINDS: readonly VaultFieldKind[] = ["username", ...VAULT_SECRET_KINDS]

/** The fields a connector types for the bot; a passkey is used, never typed. */
export type VaultRevealKind = "username" | "password" | "otp"

export const VAULT_REVEAL_KINDS: readonly VaultRevealKind[] = ["username", "password", "otp"]

/** The kinds the leak guard fingerprints: the username and one-time codes are not. */
export const GUARDED_KINDS: readonly VaultSecretKind[] = ["password", "passkey"]

/** One field of a provider account's setup form. */
export interface VaultSetupField {
  /** Lower-case letters, digits and `_`, starting with a letter. */
  readonly key: string
  readonly label: ConnectorText
  /** `secret` values are kept in DSH's credential store and never shown again. */
  readonly kind: "secret" | "text" | "url"
  readonly required: boolean
  readonly help?: ConnectorText
}

/** What a provider says about itself (its tooling being downloaded, ready, failed). */
export type VaultProviderStatus =
  | { readonly state: "ready" }
  | { readonly state: "preparing"; readonly step?: string }
  | { readonly state: "failed"; readonly reason: string }

/** A site a login may be filled in. */
export interface VaultSite {
  /** `<scheme>://<host>[:port]`. */
  readonly origin: string
  /** Hosts ending in `.<host>` match too (same scheme and port). */
  readonly subdomains: boolean
}

export interface VaultProviderView {
  readonly id: string
  readonly name: string
  readonly guide?: string
  readonly setup: readonly VaultSetupField[]
  readonly kinds: readonly VaultSecretKind[]
  readonly status: VaultProviderStatus
  /** A verification-only provider (the fake vault), shown as such. */
  readonly development: boolean
}

export type VaultAccountStatus = "active" | "error"

export const VAULT_ACCOUNT_STATUSES: readonly VaultAccountStatus[] = ["active", "error"]

export interface VaultAccountView {
  /** `vacct-<hex>`. */
  readonly id: string
  readonly provider: string
  readonly label: string
  /** The provider's identity of the account (an account URL). */
  readonly subject: string
  readonly status: VaultAccountStatus
  readonly statusReason?: string
  readonly createdAt: number
  /** Bots holding a login of it. */
  readonly bots: readonly string[]
}

/** A registered connector with a tool that fills logins (`vault: true`). */
export interface VaultFillerView {
  readonly id: string
  readonly name: string
}

/** What `botVaults.watch` streams. */
export interface BotVaultsSnapshot {
  readonly providers: readonly VaultProviderView[]
  readonly accounts: readonly VaultAccountView[]
  /** Connectors a login may be given to. */
  readonly fillers: readonly VaultFillerView[]
  /** Unacknowledged incidents per bot id (bots without any are absent). */
  readonly openIncidents: Readonly<Record<string, number>>
}

/** One item of an account, as the owner picks it: never a value. */
export interface VaultItemView {
  readonly accountId: string
  readonly vaultId: string
  readonly itemId: string
  readonly vaultName: string
  readonly title: string
  readonly username?: string
  readonly websites: readonly string[]
  /** The kinds the item has a field of and the provider can hand out. */
  readonly kinds: readonly VaultFieldKind[]
  readonly updatedAt?: number
}

/** Whether a login's item can still be read. */
export type VaultGrantAvailability = "available" | "missing" | "unchecked"

/** What the leak guard knows of a secret of a login. */
export interface VaultGuardState {
  readonly kind: VaultSecretKind
  /**
   * `short`: under {@link MIN_GUARDED_LENGTH} bytes, too short to look for;
   * `stale`: made with a guard key that is no longer the installation's, so
   * the bot's tool results are withheld until the login is fingerprinted again.
   */
  readonly state: "fingerprinted" | "short" | "stale"
  readonly at: number
}

/** A login a bot may use, as its owner sees it. */
export interface VaultGrantView {
  /** `cred-<hex>`: the handle the bot names it by. */
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
  /** Connectors (ids) whose tools may fill it. */
  readonly connectors: readonly string[]
  readonly grantedAt: number
  readonly availability: VaultGrantAvailability
  readonly guard: readonly VaultGuardState[]
  readonly lastUsedAt?: number
}

/** Where a value was put. */
export type VaultUseTarget =
  | { readonly kind: "browser"; readonly origin: string }
  | { readonly kind: "desktop"; readonly application: string }

/** One reveal of a login's field (never its value). */
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

/**
 * Where a secret was found: a tool's result or arguments, what the bot wrote
 * (its reply or reasoning), a message a person sent through a channel, or
 * text bot-core hands the bot (a notice, an action's result, notes, skills).
 */
export type VaultIncidentSource =
  | "tool-result"
  | "tool-arguments"
  | "assistant-message"
  | "inbound-message"
  | "bot-context"

/**
 * - `redacted`: the value was withheld before the model read it;
 * - `exposed`: the model already had it (it wrote it): change the password.
 */
export type VaultIncidentOutcome = "redacted" | "exposed"

/** A secret of a login found where the bot reads or writes. */
export interface VaultIncidentView {
  readonly id: string
  readonly botId: string
  readonly sessionId?: string
  readonly at: number
  readonly source: VaultIncidentSource
  readonly tool?: string
  readonly grantId: string
  /** The login's name when it happened. */
  readonly label: string
  readonly kind: VaultSecretKind
  readonly outcome: VaultIncidentOutcome
  readonly acknowledgedAt?: number
  /** How many more times the same happened before it was acknowledged, and the last time. */
  readonly repeats?: number
  readonly lastAt?: number
}

/** What `botVaults.watchBot` streams. */
export interface BotVaultView {
  readonly botId: string
  readonly grants: readonly VaultGrantView[]
  /** Newest first. */
  readonly uses: readonly VaultUseView[]
  /** Newest first. */
  readonly incidents: readonly VaultIncidentView[]
}

/** A new account: its label and setup values (secrets travel once, to the Host's credential store). */
export interface VaultAccountRequest {
  readonly provider: string
  readonly label: string
  readonly values: Readonly<Record<string, string>>
}

/** A new login of a bot. Absent fields take the item's defaults. */
export interface VaultGrantRequest {
  readonly accountId: string
  readonly vaultId: string
  readonly itemId: string
  readonly label?: string
  readonly kinds: readonly VaultFieldKind[]
  /** The connectors that may fill it: the owner picks them, at least one. */
  readonly connectors: readonly string[]
  readonly sites?: readonly VaultSite[]
  readonly desktop?: boolean
  readonly showUsername?: boolean
}

/** A change of a login; an empty change fingerprints its secrets again (a stale guard key). */
export interface VaultGrantChange {
  readonly label?: string
  readonly kinds?: readonly VaultFieldKind[]
  readonly connectors?: readonly string[]
  readonly sites?: readonly VaultSite[]
  readonly desktop?: boolean
  readonly showUsername?: boolean
}

/** The `botVaults` Remote: the owner's password managers and the bots' logins. Owner only; never a value. */
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

/** A secret shorter than this many bytes is not looked for (too many false matches). */
export const MIN_GUARDED_LENGTH = 6

export const MAX_VAULT_LABEL = 60
export const MAX_VAULT_CONNECTORS = 20

const CONNECTOR_ID = /^[a-z][a-z0-9_]*$/

/** Why a login's connectors cannot be stored, or undefined. */
export function connectorsProblem(connectors: readonly string[]): string | undefined {
  if (connectors.length === 0) return "choose at least one connector that may fill it"
  if (connectors.length > MAX_VAULT_CONNECTORS) return `at most ${MAX_VAULT_CONNECTORS} connectors`
  if (connectors.some((id) => !CONNECTOR_ID.test(id))) return "a connector id is malformed"
  if (new Set(connectors).size !== connectors.length) return "a connector is listed twice"
  return undefined
}

/** A login's handle: `cred-` and lower-case hex. */
export const isCredentialHandle = (value: unknown): value is string =>
  typeof value === "string" && /^cred-[0-9a-f]{6,32}$/.test(value)
export const MAX_VAULT_SITES = 20

/** A label as stored: trimmed, 1 to {@link MAX_VAULT_LABEL} characters, no control characters. */
export function vaultLabelProblem(label: string): string | undefined {
  const trimmed = label.trim()
  if (trimmed === "") return "the name is empty"
  if (trimmed.length > MAX_VAULT_LABEL)
    return `the name is longer than ${MAX_VAULT_LABEL} characters`
  if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) return "the name has control characters"
  return undefined
}

/** The origin of an http(s) URL, or undefined. */
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

/** The default sites of an item: the https origins of its websites, once each. */
export function defaultSites(websites: readonly string[]): readonly VaultSite[] {
  const origins = new Set<string>()
  for (const website of websites) {
    const origin = originOf(website)
    if (origin?.startsWith("https://")) origins.add(origin)
  }
  return [...origins].map((origin) => ({ origin, subdomains: false }))
}

/**
 * Whether a frame's origin is one of the sites: the same scheme, host and
 * port; with `subdomains`, a host ending in `.<host>` as well. Only an
 * https site takes subdomains; any other scheme matches its exact origin.
 */
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

/**
 * Whether a passkey's relying party may be used on the origin: its id is the
 * origin's host or a parent domain of it with at least two labels.
 */
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

/** Why a site list cannot be stored, or undefined. */
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
