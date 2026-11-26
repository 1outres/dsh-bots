import type { BotSettingsArea } from "../../settings-contract"
import type { BotChannelText } from "../../shared/channels"
import {
  type BotSettingChangeRecord,
  type BotSettingHistoryRow,
  type BotSettingJson,
  type BotSettingRevertResult,
  type BotSettingRevertState,
  type BotSettingsHistoryView,
  sameSettingJson,
} from "../../shared/settings"
import type { SettingsCatalog } from "./catalog"
import type { SettingChangeStore } from "./store"

export interface SettingsPanelDeps {
  store: Pick<SettingChangeStore, "list" | "get" | "markReverted" | "subscribe">
  catalog: Pick<SettingsCatalog, "get">
  exists(botId: string): boolean
  deadline(): AbortSignal
  now(): number
  warn(message: string): void
}

export interface SettingsPanel {
  view(botId: string): BotSettingsHistoryView
  follow(botId: string): () => void
  revert(botId: string, changeId: string): Promise<BotSettingRevertResult>
  subscribe(listener: (botId: string) => void): () => void
}

const GONE: BotChannelText = {
  en: "This setting is no longer offered (its plugin is not installed).",
  ja: "この設定は今はありません（プラグインが入っていません）。",
}

const SUPERSEDED: BotChannelText = {
  en: "The setting changed again since, so this change cannot be undone.",
  ja: "その後に設定が変わったため、この変更は元に戻せません。",
}

const ALREADY: BotChannelText = {
  en: "This change has already been undone.",
  ja: "この変更はすでに元に戻しています。",
}

const NOT_FOUND: BotChannelText = {
  en: "This change is no longer in the history.",
  ja: "この変更は履歴にありません。",
}

const unreadable = (error: unknown): BotChannelText => {
  const message = error instanceof Error ? error.message : String(error)
  return {
    en: `The current settings could not be read: ${message}`,
    ja: `今の設定を読めませんでした: ${message}`,
  }
}

const touches = (left: BotSettingChangeRecord, right: BotSettingChangeRecord) =>
  left.area === right.area &&
  left.items.some((item) => right.items.some((other) => other.key === item.key))

async function revertStates(
  changes: readonly BotSettingChangeRecord[],
  area: (id: string) => BotSettingsArea | undefined,
  botId: string,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, BotSettingRevertState>> {
  const states = new Map<string, BotSettingRevertState>()
  const readings = new Map<string, Promise<ReadonlyMap<string, BotSettingJson>>>()
  const current = (id: string, found: BotSettingsArea) => {
    let reading = readings.get(id)
    if (reading === undefined) {
      reading = found
        .entries(botId, signal)
        .then(
          (entries) =>
            new Map<string, BotSettingJson>(entries.map((entry) => [entry.key, entry.value.raw])),
        )
      readings.set(id, reading)
    }
    return reading
  }
  for (const [index, change] of changes.entries()) {
    if (change.revertedAt !== undefined) {
      states.set(change.id, { state: "reverted", at: change.revertedAt })
      continue
    }
    if (changes.slice(0, index).some((later) => touches(later, change))) {
      states.set(change.id, { state: "superseded" })
      continue
    }
    const found = area(change.area)
    if (found === undefined) {
      states.set(change.id, { state: "unavailable", reason: GONE })
      continue
    }
    try {
      const values = await current(change.area, found)
      const same = change.items.every((item) => {
        const value = values.get(item.key)
        return values.has(item.key) && value !== undefined && sameSettingJson(value, item.after.raw)
      })
      states.set(change.id, same ? { state: "available" } : { state: "superseded" })
    } catch (error) {
      signal.throwIfAborted()
      states.set(change.id, { state: "unavailable", reason: unreadable(error) })
    }
  }
  return states
}

export function createSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  const states = new Map<string, ReadonlyMap<string, BotSettingRevertState>>()
  const followers = new Map<string, number>()
  const listeners = new Set<(botId: string) => void>()
  const refreshing = new Map<string, AbortController>()
  const changed = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  const requireBot = (botId: string) => {
    if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
  }
  const refresh = (botId: string) => {
    refreshing.get(botId)?.abort()
    const controller = new AbortController()
    refreshing.set(botId, controller)
    const signal = AbortSignal.any([controller.signal, deps.deadline()])
    revertStates(deps.store.list(botId), (id) => deps.catalog.get(id), botId, signal)
      .then((computed) => {
        if (controller.signal.aborted) return
        states.set(botId, computed)
        changed(botId)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          deps.warn(
            `bot-core: could not check the setting changes of bot "${botId}": ${String(error)}`,
          )
        }
      })
      .finally(() => {
        if (refreshing.get(botId) === controller) refreshing.delete(botId)
      })
  }
  deps.store.subscribe((botId) => {
    if ((followers.get(botId) ?? 0) > 0) refresh(botId)
    else states.delete(botId)
    changed(botId)
  })
  const view = (botId: string): BotSettingsHistoryView => {
    requireBot(botId)
    const known = states.get(botId)
    const rows = deps.store.list(botId).map(
      (change): BotSettingHistoryRow => ({
        change,
        revert:
          change.revertedAt !== undefined
            ? { state: "reverted", at: change.revertedAt }
            : (known?.get(change.id) ?? { state: "checking" }),
      }),
    )
    return { botId, rows }
  }
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  return {
    view,
    follow(botId) {
      requireBot(botId)
      followers.set(botId, (followers.get(botId) ?? 0) + 1)
      refresh(botId)
      return () => {
        const left = (followers.get(botId) ?? 1) - 1
        if (left > 0) followers.set(botId, left)
        else {
          followers.delete(botId)
          refreshing.get(botId)?.abort()
          states.delete(botId)
        }
      }
    },
    revert: (botId, changeId) =>
      serial(async (): Promise<BotSettingRevertResult> => {
        requireBot(botId)
        const change = deps.store.get(botId, changeId)
        if (change === undefined) return { reverted: false, reason: NOT_FOUND }
        if (change.revertedAt !== undefined) return { reverted: false, reason: ALREADY }
        const computed = await revertStates(
          deps.store.list(botId),
          (id) => deps.catalog.get(id),
          botId,
          deps.deadline(),
        )
        const state = computed.get(changeId)
        if (state?.state === "superseded") return { reverted: false, reason: SUPERSEDED }
        if (state?.state === "unavailable") return { reverted: false, reason: state.reason }
        const area = deps.catalog.get(change.area)
        if (area === undefined) return { reverted: false, reason: GONE }
        const result = await area.apply(
          botId,
          change.items.map((item) => ({ key: item.key, value: item.before.raw })),
        )
        if (!result.applied) return { reverted: false, reason: result.reason }
        await deps.store.markReverted(botId, changeId, deps.now())
        return { reverted: true, view: view(botId) }
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
