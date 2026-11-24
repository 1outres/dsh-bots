import {
  BOT_WEB_CAPABILITIES,
  type BotWebBackendView,
  type BotWebCapability,
  type BotWebCapabilityStatus,
  type BotWebSettings,
  type BotWebStatus,
} from "../../shared/web"
import type { BotWebBackend } from "../../web-contract"

/** Everything the status is computed from; the state itself lives in host/web/state.ts. */
export interface WebStatusInput {
  readonly settings: BotWebSettings
  /** The settings' backend, if registered. */
  readonly backend: BotWebBackend | undefined
  /** Its secret keys with a stored value; `undefined` without DSH's `credentials` service. */
  readonly setKeys: ReadonlySet<string> | undefined
}

/** Which capabilities the backend can serve, whatever the settings say. */
export interface WebServable {
  readonly backend: string
  readonly search: boolean
  readonly fetch: boolean
}

export function servable(input: Pick<WebStatusInput, "settings" | "backend">): WebServable {
  const { settings, backend } = input
  return {
    backend: settings.backend,
    search: backend?.search !== undefined,
    fetch: backend?.fetch !== undefined,
  }
}

/** disabled → unavailable → missing-secrets → ready. */
export function capabilityStatus(
  input: WebStatusInput,
  capability: BotWebCapability,
): BotWebCapabilityStatus {
  const { settings, backend, setKeys } = input
  if (!settings[capability]) return { state: "disabled" }
  const id = settings.backend
  if (backend === undefined) return { state: "unavailable", backend: id, reason: "not-registered" }
  if (backend[capability] === undefined) {
    return { state: "unavailable", backend: id, reason: "no-capability" }
  }
  if (setKeys === undefined) {
    return { state: "unavailable", backend: id, reason: "no-credentials-service" }
  }
  const keys = backend.secrets.map((secret) => secret.key).filter((key) => !setKeys.has(key))
  return keys.length > 0
    ? { state: "missing-secrets", backend: id, keys }
    : { state: "ready", backend: id }
}

export function webStatus(input: WebStatusInput): BotWebStatus {
  return {
    search: capabilityStatus(input, "search"),
    fetch: capabilityStatus(input, "fetch"),
  }
}

export function backendView(
  backend: BotWebBackend,
  setKeys: ReadonlySet<string> | undefined,
): BotWebBackendView {
  return {
    id: backend.id,
    name: backend.name,
    ...(backend.description === undefined ? {} : { description: backend.description }),
    capabilities: BOT_WEB_CAPABILITIES.filter((capability) => backend[capability] !== undefined),
    secrets: backend.secrets.map((secret) => ({
      key: secret.key,
      label: secret.label,
      set: setKeys?.has(secret.key) === true,
    })),
  }
}
