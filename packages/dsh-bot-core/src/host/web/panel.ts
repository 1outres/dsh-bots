import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import {
  type BotWebCapability,
  type BotWebErrorCode,
  type BotWebErrorDetails,
  type BotWebSecretChange,
  type BotWebTestResult,
  type BotWebView,
  isWebCapability,
  MAX_WEB_SECRET_LENGTH,
} from "../../shared/web"
import type { BotWebBackend } from "../../web-contract"
import type { WebState } from "./state"
import type { WebSettingsStore } from "./store"
import type { WebTester } from "./tester"
import type { WebSecretVault } from "./vault"

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap extends BotWebErrorDetails {}
}

/** What the `botWeb` Remote serves. */
export interface WebPanel {
  view(): BotWebView
  setEnabled(capability: unknown, enabled: unknown): Promise<BotWebView>
  setSecret(key: unknown, change: unknown): Promise<BotWebView>
  test(): Promise<BotWebTestResult>
}

export interface WebPanelDeps {
  readonly state: WebState
  readonly store: WebSettingsStore
  readonly tester: WebTester
}

const refuse = (code: BotWebErrorCode, message: string) => new RemoteError(code, message, {})
const bad = (message: string) => new RemoteError("gateway/bad-request", message, {})

function parseChange(change: unknown): BotWebSecretChange {
  if (typeof change !== "object" || change === null) throw bad("change must be an object")
  const { op, value } = change as { op?: unknown; value?: unknown }
  if (op === "clear") return { op: "clear" }
  if (op !== "set") throw bad('change.op must be "set" or "clear"')
  if (typeof value !== "string") throw bad("change.value must be text")
  const trimmed = value.trim()
  if (trimmed.length === 0) throw bad("change.value is empty")
  if (trimmed.length > MAX_WEB_SECRET_LENGTH) {
    throw bad(`change.value is longer than ${MAX_WEB_SECRET_LENGTH}`)
  }
  return { op: "set", value: trimmed }
}

export function createWebPanel(deps: WebPanelDeps): WebPanel {
  const { state, store, tester } = deps
  const vaultOf = (): WebSecretVault => {
    const vault = state.vault()
    if (vault === undefined) {
      throw refuse("bot-web/unavailable", "DSH's credential store is not available")
    }
    return vault
  }
  const backendOf = (): BotWebBackend => {
    const backend = state.backend()
    if (backend === undefined) {
      throw refuse(
        "bot-web/not-registered",
        `the web backend "${state.settings().backend}" is not registered`,
      )
    }
    return backend
  }
  return {
    view: state.view,
    async setEnabled(capability, enabled) {
      if (!isWebCapability(capability)) throw bad('capability must be "search" or "fetch"')
      if (typeof enabled !== "boolean") throw bad("enabled must be true or false")
      const backend = state.backend()
      if (enabled && backend !== undefined && backend[capability] === undefined) {
        throw refuse(
          "bot-web/no-capability",
          `the web backend "${backend.id}" cannot ${capability}`,
        )
      }
      await store.setEnabled(capability satisfies BotWebCapability, enabled)
      return state.view()
    },
    async setSecret(key, change) {
      if (typeof key !== "string") throw bad("key must be text")
      const parsed = parseChange(change)
      const vault = vaultOf()
      const backend = backendOf()
      if (!backend.secrets.some((secret) => secret.key === key)) {
        throw refuse(
          "bot-web/unknown-secret",
          `the web backend "${backend.id}" has no secret "${key}"`,
        )
      }
      const secrets = await vault.change(
        backend.id,
        key,
        parsed.op === "set" ? parsed.value : undefined,
      )
      state.stored(backend.id, secrets)
      return state.view()
    },
    async test() {
      const vault = vaultOf()
      const backend = backendOf()
      if (tester.busy) throw refuse("bot-web/busy", "a connection test is already running")
      const secrets = await vault.read(backend.id)
      state.stored(backend.id, secrets)
      const missing = backend.secrets.filter((secret) => secrets[secret.key] === undefined)
      if (missing.length > 0) {
        throw refuse(
          "bot-web/missing-secrets",
          `set ${missing.map((secret) => secret.label.en).join(", ")} first`,
        )
      }
      return tester.run(backend, secrets)
    },
  }
}
