import {
  type BotVaultsSnapshot,
  type BotVaultView,
  connectorsProblem,
  defaultSites,
  originOf,
  sitesProblem,
  VAULT_FIELD_KINDS,
  type VaultAccountView,
  type VaultFieldKind,
  type VaultFillerView,
  type VaultGrantView,
  type VaultIncidentView,
  type VaultItemView,
  type VaultProviderView,
  type VaultSite,
  type VaultUseView,
  vaultLabelProblem,
} from "../../shared/vaults"
import type { BotVaultProvider, VaultItemSummary } from "../../vault-contract"
import type { RemoteCaller } from "../connectors/approvals"
import type { VaultAccess } from "./access"
import type { VaultAvailability } from "./availability"
import type { VaultAccountRecord, VaultGrantRecord, VaultUseRecord } from "./domain"
import { incidentView, type VaultGuard } from "./guard"
import type { VaultProviders } from "./providers"
import type { VaultRecords } from "./records"
import { type VaultSessions, vaultSetupOf, wipeSetup } from "./sessions"
import type { VaultStore } from "./store"

export interface VaultPanelDeps {
  store: VaultStore
  providers: Pick<VaultProviders, "get" | "list" | "subscribe">
  sessions: Pick<VaultSessions, "session" | "adopt" | "close">
  records: Pick<VaultRecords, "writeSetup" | "removeSetup">
  access: Pick<VaultAccess, "item" | "fingerprintGrant">
  availability: VaultAvailability
  guard: Pick<VaultGuard, "keyId">
  /** Registered connectors with a tool that fills logins, and their changes. */
  fillers(): readonly VaultFillerView[]
  onFillersChange(listener: () => void): () => void
  /** Whether the bot is stored. */
  exists(botId: string): boolean
  /** `<prefix>-<random hex>`. */
  newId(prefix: "vacct" | "cred"): string
  now(): number
  deadline(ms: number): AbortSignal
}

/** The owner's password managers and the bots' logins (the `botVaults` Remote). Owner only. */
export interface VaultPanel {
  snapshot(caller: RemoteCaller | undefined): BotVaultsSnapshot
  addAccount(caller: RemoteCaller | undefined, request: unknown): Promise<VaultAccountView>
  renameAccount(
    caller: RemoteCaller | undefined,
    accountId: string,
    label: unknown,
  ): Promise<VaultAccountView>
  removeAccount(
    caller: RemoteCaller | undefined,
    accountId: string,
  ): Promise<{ readonly removedGrants: number }>
  listItems(
    caller: RemoteCaller | undefined,
    accountId: string,
    query: unknown,
  ): Promise<readonly VaultItemView[]>
  bot(caller: RemoteCaller | undefined, botId: string): BotVaultView
  /** Read the bot's items again (whether each is still there). */
  refresh(botId: string): Promise<void>
  grant(caller: RemoteCaller | undefined, botId: string, request: unknown): Promise<VaultGrantView>
  updateGrant(
    caller: RemoteCaller | undefined,
    botId: string,
    grantId: string,
    change: unknown,
  ): Promise<VaultGrantView>
  revoke(
    caller: RemoteCaller | undefined,
    botId: string,
    grantId: string,
  ): Promise<{ readonly revoked: true }>
  acknowledgeIncident(
    caller: RemoteCaller | undefined,
    botId: string,
    incidentId: string,
  ): Promise<VaultIncidentView>
  subscribe(listener: () => void): () => void
  subscribeBot(botId: string, listener: () => void): () => void
}

const CONNECT_TIMEOUT_MS = 60_000
const LIST_TIMEOUT_MS = 60_000
const MAX_ITEMS = 100

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function owner(caller: RemoteCaller | undefined): void {
  if (caller?.kind !== "owner") {
    throw new Error("only the owner of this DSH manages password managers and logins")
  }
}

function labelOf(value: unknown): string {
  if (typeof value !== "string") throw new Error("the name must be text")
  const problem = vaultLabelProblem(value)
  if (problem !== undefined) throw new Error(problem)
  return value.trim()
}

function kindsOf(value: unknown): VaultFieldKind[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("choose at least one field")
  const kinds = new Set<VaultFieldKind>()
  for (const kind of value) {
    if (!VAULT_FIELD_KINDS.includes(kind)) throw new Error(`unknown field ${JSON.stringify(kind)}`)
    kinds.add(kind)
  }
  return VAULT_FIELD_KINDS.filter((kind) => kinds.has(kind))
}

function sitesOf(value: unknown): VaultSite[] {
  if (!Array.isArray(value)) throw new Error("sites must be a list")
  const sites = value.map((site) => {
    if (
      !isRecord(site) ||
      typeof site.origin !== "string" ||
      typeof site.subdomains !== "boolean"
    ) {
      throw new Error("a site is an origin and whether its subdomains count")
    }
    return { origin: site.origin.trim(), subdomains: site.subdomains }
  })
  const problem = sitesProblem(sites)
  if (problem !== undefined) throw new Error(problem)
  return sites
}

function connectorIdsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error("connectors must be a list of connector ids")
  }
  const problem = connectorsProblem(value)
  if (problem !== undefined) throw new Error(problem)
  return [...value]
}

function booleanOf(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${what} must be true or false`)
  return value
}

/** The kinds an item offers through its provider. */
function itemKinds(provider: BotVaultProvider, item: VaultItemSummary): VaultFieldKind[] {
  const present = new Set<VaultFieldKind>(item.fields.map((field) => field.kind))
  if (item.username !== undefined) present.add("username")
  return VAULT_FIELD_KINDS.filter(
    (kind) => present.has(kind) && (kind === "username" || provider.kinds.includes(kind)),
  )
}

export function createVaultPanel(deps: VaultPanelDeps): VaultPanel {
  const providerView = (provider: BotVaultProvider): VaultProviderView => ({
    id: provider.id,
    name: provider.name,
    ...(provider.guide === undefined ? {} : { guide: provider.guide }),
    setup: provider.setup,
    kinds: provider.kinds,
    status: provider.status?.read() ?? { state: "ready" },
    development: provider.development === true,
  })
  const accountView = (record: VaultAccountRecord): VaultAccountView => ({
    ...record,
    bots: [
      ...new Set(
        deps.store
          .grantsOfAccount(record.id)
          .map((grant) => grant.botId)
          .filter(deps.exists),
      ),
    ],
  })
  const grantView = (grant: VaultGrantRecord, uses: readonly VaultUseRecord[]): VaultGrantView => {
    const lastUsed = uses.find((use) => use.grantId === grant.id && use.outcome === "filled")
    return {
      ...grant,
      availability: deps.availability.get(grant.botId, grant.id),
      guard: deps.store
        .fingerprints(grant.botId)
        .filter((record) => record.grantId === grant.id && record.revokedAt === undefined)
        .map((record) => ({
          kind: record.kind,
          state: stale(record.keyId) ? ("stale" as const) : record.state,
          at: record.at,
        })),
      ...(lastUsed === undefined ? {} : { lastUsedAt: lastUsed.at }),
    }
  }
  const stale = (keyId: string) => {
    const current = deps.guard.keyId()
    return current !== undefined && current !== keyId
  }
  const requireAccount = (accountId: unknown) => {
    const record = typeof accountId === "string" ? deps.store.account(accountId) : undefined
    if (record === undefined) throw new Error("no such password manager account")
    return record
  }
  const requireProvider = (providerId: string) => {
    const provider = deps.providers.get(providerId)
    if (provider === undefined)
      throw new Error(`the password manager "${providerId}" is not installed`)
    return provider
  }
  const requireBot = (botId: string) => {
    if (typeof botId !== "string" || !deps.exists(botId))
      throw new Error(`bot "${botId}" does not exist`)
  }
  const requireGrant = (botId: string, grantId: unknown) => {
    const grant = typeof grantId === "string" ? deps.store.grant(botId, grantId) : undefined
    if (grant === undefined) throw new Error("no such login")
    return grant
  }
  const itemOf = async (account: VaultAccountRecord, vaultId: string, itemId: string) => {
    const session = await deps.sessions.session(account.id, deps.deadline(LIST_TIMEOUT_MS))
    const item = await session.item({ vaultId, itemId }, deps.deadline(LIST_TIMEOUT_MS))
    if (item === undefined) throw new Error("the item is gone or out of reach")
    return item
  }
  const fingerprint = async (grant: VaultGrantRecord) => {
    try {
      await deps.access.fingerprintGrant(grant.botId, grant.id, deps.deadline(LIST_TIMEOUT_MS))
    } catch (error) {
      throw new Error(
        `the login was not saved: its secret could not be read for the leak guard (${messageOf(error)})`,
      )
    }
  }

  return {
    snapshot(caller) {
      owner(caller)
      return {
        providers: deps.providers.list().map(providerView),
        accounts: deps.store.accounts().map(accountView),
        fillers: deps.fillers(),
        openIncidents: Object.fromEntries(
          Object.entries(deps.store.openIncidents()).filter(([botId]) => deps.exists(botId)),
        ),
      }
    },
    async addAccount(caller, request) {
      owner(caller)
      if (!isRecord(request) || typeof request.provider !== "string" || !isRecord(request.values)) {
        throw new Error("an account needs its provider and setup values")
      }
      const provider = requireProvider(request.provider)
      const label = labelOf(request.label)
      const values: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.values)) {
        const field = provider.setup.find((each) => each.key === key)
        if (field === undefined) throw new Error(`${provider.name} has no setup field "${key}"`)
        if (typeof value !== "string") throw new Error(`${field.label.en} must be text`)
        const trimmed = field.kind === "secret" ? value : value.trim()
        if (trimmed === "") continue
        if (field.kind === "url" && originOf(trimmed) === undefined) {
          throw new Error(`${field.label.en} is not an http(s) URL`)
        }
        values[key] = trimmed
      }
      const missing = provider.setup.find(
        (field) => field.required && values[field.key] === undefined,
      )
      if (missing !== undefined) throw new Error(`${missing.label.en} is required`)
      const signal = deps.deadline(CONNECT_TIMEOUT_MS)
      const setup = vaultSetupOf(provider, values)
      let session: Awaited<ReturnType<typeof provider.open>>
      try {
        session = await provider.open(setup, signal)
      } catch (error) {
        wipeSetup(setup)
        throw new Error(`${provider.name} did not accept the account: ${messageOf(error)}`)
      }
      let identity: { readonly subject: string; readonly label: string }
      try {
        identity = await session.identify(signal)
      } catch (error) {
        await session.close().catch(() => {})
        throw new Error(`${provider.name} did not accept the account: ${messageOf(error)}`)
      }
      const taken = deps.store
        .accounts()
        .find((account) => account.provider === provider.id && account.subject === identity.subject)
      if (taken !== undefined) {
        await session.close().catch(() => {})
        throw new Error(`this account is already connected as "${taken.label}"`)
      }
      const record: VaultAccountRecord = {
        id: deps.newId("vacct"),
        provider: provider.id,
        label,
        subject: identity.subject,
        status: "active",
        createdAt: deps.now(),
      }
      try {
        await deps.records.writeSetup(record.id, values)
        await deps.store.putAccount(record)
      } catch (error) {
        await session.close().catch(() => {})
        await deps.records.removeSetup(record.id).catch(() => {})
        throw error
      }
      deps.sessions.adopt(record.id, session)
      return accountView(record)
    },
    async renameAccount(caller, accountId, label) {
      owner(caller)
      requireAccount(accountId)
      return accountView(await deps.store.renameAccount(accountId, labelOf(label)))
    },
    async removeAccount(caller, accountId) {
      owner(caller)
      const record = requireAccount(accountId)
      await deps.sessions.close(record.id)
      const removed = await deps.store.removeAccount(record.id)
      await deps.records.removeSetup(record.id)
      return { removedGrants: removed.length }
    },
    async listItems(caller, accountId, query) {
      owner(caller)
      const record = requireAccount(accountId)
      const provider = requireProvider(record.provider)
      if (typeof query !== "string") throw new Error("the search must be text")
      const wanted = query.trim().toLowerCase()
      const session = await deps.sessions.session(record.id, deps.deadline(LIST_TIMEOUT_MS))
      const items = await session.listItems(deps.deadline(LIST_TIMEOUT_MS))
      return items
        .filter(
          (item) =>
            wanted === "" ||
            [item.title, item.username ?? "", item.vaultName, ...item.websites].some((text) =>
              text.toLowerCase().includes(wanted),
            ),
        )
        .slice(0, MAX_ITEMS)
        .map((item) => ({
          accountId: record.id,
          vaultId: item.vaultId,
          itemId: item.itemId,
          vaultName: item.vaultName,
          title: item.title,
          ...(item.username === undefined ? {} : { username: item.username }),
          websites: item.websites,
          kinds: itemKinds(provider, item),
          ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
        }))
    },
    bot(caller, botId) {
      owner(caller)
      requireBot(botId)
      const uses = deps.store.uses(botId)
      return {
        botId,
        grants: deps.store.grants(botId).map((grant) => grantView(grant, uses)),
        uses: uses.map((use): VaultUseView => use),
        incidents: deps.store.incidents(botId).map(incidentView),
      }
    },
    async refresh(botId) {
      await Promise.all(
        deps.store
          .grants(botId)
          .map((grant) => deps.access.item(grant, deps.deadline(LIST_TIMEOUT_MS)).catch(() => {})),
      )
    },
    async grant(caller, botId, request) {
      owner(caller)
      requireBot(botId)
      if (
        !isRecord(request) ||
        typeof request.vaultId !== "string" ||
        typeof request.itemId !== "string"
      ) {
        throw new Error("a login needs its account, vault and item")
      }
      const account = requireAccount(request.accountId)
      const provider = requireProvider(account.provider)
      const item = await itemOf(account, request.vaultId, request.itemId)
      const kinds = kindsOf(request.kinds)
      const offered = itemKinds(provider, item)
      const unavailable = kinds.find((kind) => !offered.includes(kind))
      if (unavailable !== undefined)
        throw new Error(`the item has no ${unavailable} ${provider.name} can hand out`)
      const record: VaultGrantRecord = {
        id: deps.newId("cred"),
        botId,
        accountId: account.id,
        vaultId: item.vaultId,
        itemId: item.itemId,
        label:
          request.label === undefined ? labelOf(item.title.slice(0, 60)) : labelOf(request.label),
        kinds,
        sites:
          request.sites === undefined ? [...defaultSites(item.websites)] : sitesOf(request.sites),
        desktop: request.desktop === undefined ? false : booleanOf(request.desktop, "desktop"),
        connectors: connectorIdsOf(request.connectors),
        showUsername:
          request.showUsername === undefined
            ? true
            : booleanOf(request.showUsername, "showUsername"),
        grantedAt: deps.now(),
      }
      await deps.store.putGrant(record)
      try {
        await fingerprint(record)
      } catch (error) {
        await deps.store.removeGrant(botId, record.id)
        throw error
      }
      deps.availability.set(botId, record.id, "available")
      return grantView(record, deps.store.uses(botId))
    },
    async updateGrant(caller, botId, grantId, change) {
      owner(caller)
      requireBot(botId)
      const grant = requireGrant(botId, grantId)
      if (!isRecord(change)) throw new Error("a change is an object")
      const account = requireAccount(grant.accountId)
      let kinds = grant.kinds
      if (change.kinds !== undefined) {
        kinds = kindsOf(change.kinds)
        const offered = itemKinds(
          requireProvider(account.provider),
          await itemOf(account, grant.vaultId, grant.itemId),
        )
        const unavailable = kinds.find((kind) => !offered.includes(kind))
        if (unavailable !== undefined) throw new Error(`the item has no ${unavailable}`)
      }
      const updated: VaultGrantRecord = {
        ...grant,
        kinds,
        ...(change.label === undefined ? {} : { label: labelOf(change.label) }),
        ...(change.sites === undefined ? {} : { sites: sitesOf(change.sites) }),
        ...(change.desktop === undefined ? {} : { desktop: booleanOf(change.desktop, "desktop") }),
        ...(change.connectors === undefined
          ? {}
          : { connectors: connectorIdsOf(change.connectors) }),
        ...(change.showUsername === undefined
          ? {}
          : { showUsername: booleanOf(change.showUsername, "showUsername") }),
      }
      const added = kinds.filter((kind) => !grant.kinds.includes(kind))
      const staleKinds = deps.store
        .fingerprints(botId)
        .some(
          (record) =>
            record.grantId === grant.id && record.revokedAt === undefined && stale(record.keyId),
        )
      if (added.includes("password") || added.includes("passkey") || staleKinds) {
        await deps.store.putGrant(updated)
        try {
          await fingerprint(updated)
        } catch (error) {
          await deps.store.putGrant(grant)
          throw error
        }
      } else {
        await deps.store.putGrant(updated)
      }
      return grantView(updated, deps.store.uses(botId))
    },
    async revoke(caller, botId, grantId) {
      owner(caller)
      requireBot(botId)
      const grant = requireGrant(botId, grantId)
      await deps.store.removeGrant(botId, grant.id)
      return { revoked: true }
    },
    async acknowledgeIncident(caller, botId, incidentId) {
      owner(caller)
      requireBot(botId)
      if (typeof incidentId !== "string") throw new Error("no such incident")
      return incidentView(await deps.store.acknowledge(botId, incidentId))
    },
    subscribe(listener) {
      const offs = [
        deps.providers.subscribe(listener),
        deps.store.subscribe(() => listener()),
        deps.onFillersChange(listener),
      ]
      return () => {
        for (const off of offs) off()
      }
    },
    subscribeBot(botId, listener) {
      const offs = [
        deps.store.subscribe((changed) => {
          if (changed === undefined || changed === botId) listener()
        }),
        deps.availability.subscribe((changed) => {
          if (changed === botId) listener()
        }),
      ]
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
