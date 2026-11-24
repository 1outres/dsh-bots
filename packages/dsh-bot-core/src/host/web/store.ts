import type { BotWebCapability, BotWebSettings } from "../../shared/web"
import { DEFAULT_WEB_SETTINGS } from "../../shared/web"
import type { BotTable } from "../registry"
import { WEB_SETTINGS_KEY } from "./domain"

export interface WebSettingsStoreDeps {
  /** The settings table of WEB_DOMAIN; only the store writes it (design rule 44). */
  webSettings: BotTable<BotWebSettings>
}

/** Every bot's web lookup settings, as stored. Writes are serialized. */
export interface WebSettingsStore {
  current(): BotWebSettings
  setEnabled(capability: BotWebCapability, enabled: boolean): Promise<BotWebSettings>
  /** Called after every stored change. */
  subscribe(listener: () => void): () => void
}

/** Opens the store; a first start stores {@link DEFAULT_WEB_SETTINGS}, and only stored values are read after that. */
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
