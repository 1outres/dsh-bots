import type { BotSettingChangeRecord } from "../../shared/settings"
import type { BotTable } from "../registry"

export interface SettingChangeStoreDeps {
  readonly settingChanges: BotTable<BotSettingChangeRecord>
  readonly kept: number
}

export interface SettingChangeStore {
  list(botId: string): readonly BotSettingChangeRecord[]
  get(botId: string, changeId: string): BotSettingChangeRecord | undefined
  record(change: BotSettingChangeRecord): Promise<void>
  markReverted(botId: string, changeId: string, at: number): Promise<void>
  forget(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string) => void): () => void
}

const newestFirst = (left: BotSettingChangeRecord, right: BotSettingChangeRecord) =>
  right.at - left.at || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0)

export function createSettingChangeStore(deps: SettingChangeStoreDeps): SettingChangeStore {
  const { settingChanges } = deps
  const listeners = new Set<(botId: string) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const changed = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  const list = (botId: string) =>
    [...settingChanges.entries()]
      .map(([, change]) => change)
      .filter((change) => change.botId === botId)
      .sort(newestFirst)
  return {
    list,
    get(botId, changeId) {
      const change = settingChanges.get(changeId)
      return change?.botId === botId ? change : undefined
    },
    record: (change) =>
      serial(async () => {
        await settingChanges.put(change.id, change)
        for (const old of list(change.botId).slice(deps.kept)) {
          await settingChanges.delete(old.id)
        }
        changed(change.botId)
      }),
    markReverted: (botId, changeId, at) =>
      serial(async () => {
        const change = settingChanges.get(changeId)
        if (change === undefined || change.botId !== botId) {
          throw new Error(`bot "${botId}" has no setting change "${changeId}"`)
        }
        await settingChanges.put(changeId, { ...change, revertedAt: at })
        changed(botId)
      }),
    forget: (keep) =>
      serial(async () => {
        const gone = new Set<string>()
        for (const [id, change] of [...settingChanges.entries()]) {
          if (keep(change.botId)) continue
          await settingChanges.delete(id)
          gone.add(change.botId)
        }
        for (const botId of gone) changed(botId)
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
