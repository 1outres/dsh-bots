import type { BotWebCapability, BotWebSettings } from "../../shared/web"
import { DEFAULT_WEB_SETTINGS } from "../../shared/web"
import type { BotTable } from "../registry"
import { WEB_SETTINGS_KEY } from "./domain"

export interface WebSettingsStoreDeps {
  webSettings: BotTable<BotWebSettings>
}

export interface WebSettingsStore {
  current(): BotWebSettings
  setEnabled(capability: BotWebCapability, enabled: boolean): Promise<BotWebSettings>
  subscribe(listener: () => void): () => void
}

export async function openWebSettingsStore(deps: WebSettingsStoreDeps): Promise<WebSettingsStore> {
  const { webSettings } = deps
  let current = webSettings.get(WEB_SETTINGS_KEY)
  if (current === undefined) {
    await webSettings.put(WEB_SETTINGS_KEY, DEFAULT_WEB_SETTINGS)
    current = DEFAULT_WEB_SETTINGS
  }
  const listeners = new Set<() => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  return {
    current: () => current as BotWebSettings,
    setEnabled: (capability, enabled) =>
      serial(async () => {
        const before = current as BotWebSettings
        if (before[capability] === enabled) return before
        const next: BotWebSettings = { ...before, [capability]: enabled }
        await webSettings.put(WEB_SETTINGS_KEY, next)
        current = next
        for (const listener of [...listeners]) listener()
        return next
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
