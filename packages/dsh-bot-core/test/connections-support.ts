import { createHash } from "node:crypto"
import type { BotConnectionProvider, BotConnector, BotConnectorEnvironment } from "../src/contract"
import { createOAuthClients } from "../src/host/connections/clients"
import type { OAuthFetch } from "../src/host/connections/oauth"
import { createConnectionPanel } from "../src/host/connections/panel"
import { createConnectionProviders } from "../src/host/connections/providers"
import { createConnectionServices } from "../src/host/connections/services"
import { createConnectionSignIn } from "../src/host/connections/signin"
import { connectionInfo } from "../src/host/connections/store"
import { type ConnectionTokens, createConnectionTokens } from "../src/host/connections/tokens"
import {
  type ConnectionCredentialRecords,
  createConnectionVault,
} from "../src/host/connections/vault"
import { createConnectorApprovals } from "../src/host/connectors/approvals"
import { createEventPoller } from "../src/host/events/poller"
import { brokerSetup } from "./connectors-support"

export function memoryCredentials(): ConnectionCredentialRecords & {
  records: Map<string, unknown>
} {
  const records = new Map<string, unknown>()
  return {
    records,
    async readRecord(key) {
      return records.get(key) as { kind: string; payload?: unknown } | undefined
    },
    async modifyRecord(key, mutate) {
      const next = await mutate()
      if (next !== undefined) records.set(key, next)
      return next
    },
    async deleteRecord(key) {
      records.delete(key)
    },
  }
}

export const OWNER = { kind: "owner" }

export function connectionsSetup(options: {
  readonly providers: readonly BotConnectionProvider[]
  readonly connectors: readonly BotConnector[]
  readonly fetch: OAuthFetch
  readonly environment?: BotConnectorEnvironment
  readonly now?: () => number
}) {
  let tokens: ConnectionTokens | undefined
  const setup = brokerSetup({
    ...(options.environment === undefined ? {} : { connectorEnvironment: options.environment }),
    connection: (record) => ({
      info: connectionInfo(record),
      accessToken: (request) => {
        if (tokens === undefined) throw new Error("tokens are not wired")
        return tokens.accessToken(record.id, request)
      },
    }),
  })
  const now = options.now ?? setup.clock.now
  const credentials = memoryCredentials()
  const vault = createConnectionVault(credentials)
  const providers = createConnectionProviders()
  for (const provider of options.providers) providers.register(provider)
  for (const connector of options.connectors) setup.catalog.register(connector)
  const services = createConnectionServices(setup.catalog)
  const clients = createOAuthClients({ store: setup.connectionStore, vault, warn: () => {} })
  const connectionTokens = createConnectionTokens({
    store: setup.connectionStore,
    vault,
    providers,
    client: (provider) => clients.credentials(provider),
    fetch: options.fetch,
    now,
    deadline: (ms) => AbortSignal.timeout(ms),
  })
  tokens = connectionTokens
  let ids = 0
  const signIn = createConnectionSignIn({
    providers,
    services,
    store: setup.connectionStore,
    vault,
    tokens: connectionTokens,
    client: (provider) => clients.credentials(provider),
    exists: (botId) => setup.bots.has(botId),
    fetch: options.fetch,
    secret: () => `secret-${++ids}-${Math.random().toString(36).slice(2)}`,
    challenge: (verifier) => createHash("sha256").update(verifier).digest("base64url"),
    newConnectionId: () => `conn-${++ids}`,
    newAttemptId: () => `att-${++ids}`,
    now,
    later: setup.clock.later,
    deadline: (ms) => AbortSignal.timeout(ms),
  })
  const panel = createConnectionPanel({
    providers,
    services,
    store: setup.connectionStore,
    clients,
    signIn,
    vault,
    tokens: connectionTokens,
    fetch: options.fetch,
    deadline: (ms) => AbortSignal.timeout(ms),
    exists: (botId) => setup.bots.has(botId),
  })
  const poller = () =>
    createEventPoller({
      catalog: setup.catalog,
      shield: async (_botId, events) => events,
      connections: setup.connectionStore,
      subscribers: (connectionId, connector) =>
        [...setup.bots].filter(
          (botId) =>
            setup.connectionStore.isAssigned(botId, connectionId) &&
            setup.settings.delivery(botId, connector.id) !== "off",
        ),
      store: setup.eventStore,
      connection: (record) => ({
        info: connectionInfo(record),
        accessToken: (request) => connectionTokens.accessToken(record.id, request),
      }),
      later: setup.clock.later,
      deadline: (ms) => AbortSignal.timeout(ms),
      now,
      warn: (message) => setup.log.push(`warn ${message}`),
    })
  return {
    ...setup,
    credentials,
    vault,
    providers,
    clients,
    connectionTokens,
    signIn,
    panel,
    poller,
  }
}

export function actionViews(setup: ReturnType<typeof brokerSetup>, botId: string) {
  const approvals = createConnectorApprovals({ ...setup, exists: (id) => id === botId })
  return setup.ledger.list(botId).map((action) => approvals.view(action))
}
