/**
 * Connectors that require others (`BotConnector.requires`): whether a bot's
 * required connectors are ready, and whether a person operates one of them.
 */
import type { ConnectorReadiness, ConnectorStatus } from "../../shared/connectors"
import type { CatalogConnector } from "./catalog"

/** Where a connector's requirements stand for one bot. */
export type RequirementState =
  /** `key` changes whenever one of them became ready again. */
  | { readonly kind: "met"; readonly key: string }
  | { readonly kind: "waiting"; readonly connectors: readonly string[] }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface RequirementDeps {
  get(connectorId: string): CatalogConnector | undefined
  readiness(connectorId: string): ConnectorReadiness
}

export function requirementState(
  connector: CatalogConnector,
  deps: RequirementDeps,
): RequirementState {
  const keys: string[] = []
  const waiting: string[] = []
  for (const id of connector.requires ?? []) {
    const required = deps.get(id)
    if (required === undefined) {
      return { kind: "unavailable", reason: `needs the "${id}" connector, which is not installed` }
    }
    const readiness = deps.readiness(id)
    switch (readiness.state) {
      case "disabled":
        return {
          kind: "unavailable",
          reason: `needs ${required.name}, which is off for this bot: turn it on too`,
        }
      case "unavailable":
        return {
          kind: "unavailable",
          reason: `needs ${required.name}, which cannot run now: ${readiness.reason}`,
        }
      case "failed":
        return {
          kind: "unavailable",
          reason: `needs ${required.name}, which could not be prepared: ${readiness.reason}`,
        }
      case "preparing":
        waiting.push(required.name)
        break
      case "ready":
        keys.push(`${id}@${readiness.since}`)
    }
  }
  if (waiting.length > 0) return { kind: "waiting", connectors: waiting }
  return { kind: "met", key: keys.join(",") }
}

/** The name of a required connector a person operates for the bot now, if any. */
export function operatedRequirement(
  connector: CatalogConnector,
  deps: {
    get(connectorId: string): CatalogConnector | undefined
    status(required: CatalogConnector): ConnectorStatus
  },
): string | undefined {
  for (const id of connector.requires ?? []) {
    const required = deps.get(id)
    if (required !== undefined && deps.status(required).operatedBy === "person") {
      return required.name
    }
  }
  return undefined
}

/**
 * Whether every connector `connector` requires, and every one those require,
 * is registered and enabled for the bot: by settings only, not readiness.
 */
export function requirementsOn(
  connector: CatalogConnector,
  deps: {
    get(connectorId: string): CatalogConnector | undefined
    enabled(connectorId: string): boolean
  },
): boolean {
  return (connector.requires ?? []).every((id) => {
    const required = deps.get(id)
    return required !== undefined && deps.enabled(id) && requirementsOn(required, deps)
  })
}

/** `connectors` reordered so that each comes after the ones of them it requires, otherwise in their order. */
export function requirementOrder(
  connectors: readonly CatalogConnector[],
): readonly CatalogConnector[] {
  const ids = new Set(connectors.map((connector) => connector.id))
  const placed = new Set<string>()
  const ordered: CatalogConnector[] = []
  while (ordered.length < connectors.length) {
    const next = connectors.find(
      (connector) =>
        !placed.has(connector.id) &&
        (connector.requires ?? []).every((id) => !ids.has(id) || placed.has(id)),
    )
    if (next === undefined) throw new Error("bot-core: connectors that require each other")
    placed.add(next.id)
    ordered.push(next)
  }
  return ordered
}

/** The connectors that require `connectorId`, directly. */
export function dependentsOf(
  connectors: readonly CatalogConnector[],
  connectorId: string,
): readonly CatalogConnector[] {
  return connectors.filter((connector) => connector.requires?.includes(connectorId) === true)
}

/** Whether registering `connector` beside `registered` closes a cycle of requirements. */
export function closesRequirementCycle(
  connector: CatalogConnector,
  registered: readonly CatalogConnector[],
): boolean {
  const byId = new Map(registered.map((entry) => [entry.id, entry]))
  const seen = new Set<string>()
  const reaches = (id: string): boolean => {
    if (id === connector.id) return true
    if (seen.has(id)) return false
    seen.add(id)
    return (byId.get(id)?.requires ?? []).some(reaches)
  }
  return (connector.requires ?? []).some(reaches)
}
