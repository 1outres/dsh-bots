import { SKILL_VERSION_LIMIT } from "../../shared/skills"
import type { BotTable } from "../registry"
import {
  type SkillCurationRecord,
  type SkillHistoryRecord,
  type SkillMarkRecord,
  type SkillSettingsRecord,
  type SkillUsageRecord,
  type StoredSkillVersion,
  skillKey,
} from "./domain"

export interface SkillStoreDeps {
  skillHistory: BotTable<SkillHistoryRecord>
  skillUsage: BotTable<SkillUsageRecord>
  skillSettings: BotTable<SkillSettingsRecord>
  skillMarks: BotTable<SkillMarkRecord>
  skillCuration: BotTable<SkillCurationRecord>
}

export interface SkillUsage {
  readonly uses: number
  readonly lastUsedAt?: number
}

export interface SkillCurationTimes {
  readonly sweptAt?: number
  readonly curatedAt?: number
}

export interface SkillStore {
  versions(botId: string, name: string): readonly StoredSkillVersion[]
  addVersion(botId: string, name: string, version: StoredSkillVersion): Promise<void>
  names(botId: string): readonly string[]
  usage(botId: string, name: string): SkillUsage
  recordUse(botId: string, name: string, at: number): Promise<void>
  reviewEnabled(botId: string): boolean
  setReview(botId: string, enabled: boolean): Promise<void>
  curatorEnabled(botId: string): boolean
  setCurator(botId: string, enabled: boolean): Promise<void>
  kept(botId: string, name: string): boolean
  setKeep(botId: string, name: string, keep: boolean): Promise<void>
  curation(botId: string): SkillCurationTimes
  markSwept(botId: string, at: number): Promise<void>
  markCurated(botId: string, at: number): Promise<void>
  purge(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string) => void): () => void
}

export function createSkillStore(deps: SkillStoreDeps): SkillStore {
  const listeners = new Set<(botId: string) => void>()
  const publish = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const settingsOf = (botId: string): SkillSettingsRecord =>
    deps.skillSettings.get(botId) ?? { skillReview: true }
  const putSettings = (botId: string, change: Partial<SkillSettingsRecord>) =>
    serial(async () => {
      await deps.skillSettings.put(botId, { ...settingsOf(botId), ...change })
      publish(botId)
    })
  const putCuration = (botId: string, change: SkillCurationRecord) =>
    serial(async () => {
      await deps.skillCuration.put(botId, { ...deps.skillCuration.get(botId), ...change })
      publish(botId)
    })
  return {
    versions: (botId, name) => deps.skillHistory.get(skillKey(botId, name))?.versions ?? [],
    addVersion: (botId, name, version) =>
      serial(async () => {
        const key = skillKey(botId, name)
        const versions = [version, ...(deps.skillHistory.get(key)?.versions ?? [])].slice(
          0,
          SKILL_VERSION_LIMIT,
        )
        await deps.skillHistory.put(key, { botId, name, versions })
        publish(botId)
      }),
    names: (botId) =>
      [...deps.skillHistory.entries()]
        .filter(([, record]) => record.botId === botId)
        .map(([, record]) => record.name)
        .sort(),
    usage(botId, name) {
      const record = deps.skillUsage.get(skillKey(botId, name))
      return record === undefined
        ? { uses: 0 }
        : { uses: record.uses, lastUsedAt: record.lastUsedAt }
    },
    recordUse: (botId, name, at) =>
      serial(async () => {
        const key = skillKey(botId, name)
        const uses = (deps.skillUsage.get(key)?.uses ?? 0) + 1
        await deps.skillUsage.put(key, { botId, name, uses, lastUsedAt: at })
        publish(botId)
      }),
    reviewEnabled: (botId) => settingsOf(botId).skillReview,
    setReview: (botId, enabled) => putSettings(botId, { skillReview: enabled }),
    curatorEnabled: (botId) => settingsOf(botId).skillCurator ?? true,
    setCurator: (botId, enabled) => putSettings(botId, { skillCurator: enabled }),
    kept: (botId, name) => deps.skillMarks.get(skillKey(botId, name))?.keep === true,
    setKeep: (botId, name, keep) =>
      serial(async () => {
        const key = skillKey(botId, name)
        if (keep) await deps.skillMarks.put(key, { botId, name, keep: true })
        else await deps.skillMarks.delete(key)
        publish(botId)
      }),
    curation(botId) {
      const record = deps.skillCuration.get(botId)
      return {
        ...(record?.sweptAt === undefined ? {} : { sweptAt: record.sweptAt }),
        ...(record?.curatedAt === undefined ? {} : { curatedAt: record.curatedAt }),
      }
    },
    markSwept: (botId, at) => putCuration(botId, { sweptAt: at }),
    markCurated: (botId, at) => putCuration(botId, { curatedAt: at }),
    purge: (keep) =>
      serial(async () => {
        for (const [key, record] of [...deps.skillHistory.entries()]) {
          if (!keep(record.botId)) await deps.skillHistory.delete(key)
        }
        for (const [key, record] of [...deps.skillUsage.entries()]) {
          if (!keep(record.botId)) await deps.skillUsage.delete(key)
        }
        for (const [key, record] of [...deps.skillMarks.entries()]) {
          if (!keep(record.botId)) await deps.skillMarks.delete(key)
        }
        for (const [botId] of [...deps.skillSettings.entries()]) {
          if (!keep(botId)) await deps.skillSettings.delete(botId)
        }
        for (const [botId] of [...deps.skillCuration.entries()]) {
          if (!keep(botId)) await deps.skillCuration.delete(botId)
        }
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
