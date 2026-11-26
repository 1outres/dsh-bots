import type { BotWebSettings, BotWebStatus, BotWebView } from "../../shared/web"
import type { BotWebBackend } from "../../web-contract"
import type { WebBackendCatalog } from "./catalog"
import { backendView, servable, type WebServable, webStatus } from "./status"
import type { WebSettingsStore } from "./store"
import type { WebSecretVault } from "./vault"

export interface WebStateDeps {
  readonly store: WebSettingsStore
  readonly catalog: WebBackendCatalog
  warn(message: string): void
}

export interface WebState {
  settings(): BotWebSettings
  backend(): BotWebBackend | undefined
  vault(): WebSecretVault | undefined
  status(): BotWebStatus
  servable(): WebServable
  view(): BotWebView
  attachVault(vault: WebSecretVault): () => void
  stored(backendId: string, secrets: Readonly<Record<string, string>>): void
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createWebState(deps: WebStateDeps): WebState {
  const { store, catalog } = deps
  const listeners = new Set<() => void>()
  const keys = new Map<string, ReadonlySet<string>>()
  let vault: WebSecretVault | undefined
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const load = async (backendId: string, from: WebSecretVault) => {
    let found: ReadonlySet<string>
    try {
      found = new Set(Object.keys(await from.read(backendId)))
    } catch (error) {
      deps.warn(`bot-core: the web backend "${backendId}" has no usable secrets: ${String(error)}`)
      found = new Set()
    }
    if (vault !== from) return
    keys.set(backendId, found)
    notify()
  }
  const backend = () => catalog.get(store.current().backend)
  const setKeys = () => {
    const current = backend()
    return vault === undefined || current === undefined ? undefined : keys.get(current.id)
  }
  const input = () => ({ settings: store.current(), backend: backend(), setKeys: setKeys() })
  const offs = [
    store.subscribe(notify),
    catalog.subscribe((backendId) => {
      if (vault !== undefined && catalog.get(backendId) !== undefined && !keys.has(backendId)) {
        void load(backendId, vault)
      }
      notify()
    }),
  ]
  return {
    settings: store.current,
    backend,
    vault: () => vault,
    status: () => webStatus(input()),
    servable: () => servable(input()),
    view() {
      const current = input()
      return {
        backend:
          current.backend === undefined ? null : backendView(current.backend, current.setKeys),
        settings: current.settings,
        status: webStatus(current),
      }
    },
    attachVault(next) {
      vault = next
      keys.clear()
      for (const registered of catalog.list()) void load(registered.id, next)
      notify()
      return () => {
        if (vault !== next) return
        vault = undefined
        keys.clear()
        notify()
      }
    },
    stored(backendId, secrets) {
      keys.set(backendId, new Set(Object.keys(secrets)))
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      for (const off of offs) off()
      listeners.clear()
    },
  }
}
