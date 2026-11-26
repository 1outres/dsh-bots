import type { SkillRetention } from "../../shared/skills"
import type { StoredSkillVersion } from "./domain"
import type { SkillStore, SkillUsage } from "./store"

export const DAY_MS = 24 * 60 * 60_000
export const UNUSED_ARCHIVE_DAYS = 30
export const UNUSED_ARCHIVE_MS = UNUSED_ARCHIVE_DAYS * DAY_MS
export const UNUSED_ARCHIVE_REASON = `Unused for ${UNUSED_ARCHIVE_DAYS} days`

const WORD = "A-Za-z0-9_-"

export function namesSkill(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![${WORD}])${escaped}(?![${WORD}])`, "i").test(text)
}

export function lastActiveAt(
  usage: SkillUsage,
  versions: readonly StoredSkillVersion[],
): number | undefined {
  const times = [usage.lastUsedAt, versions[0]?.at].filter((at): at is number => at !== undefined)
  return times.length === 0 ? undefined : Math.max(...times)
}

export interface SkillRetentionDeps {
  store: Pick<SkillStore, "kept" | "usage" | "versions">
  jobTexts(botId: string): readonly string[]
}

export interface SkillRetentions {
  of(botId: string, name: string): SkillRetention
  due(botId: string, names: readonly string[], now: number): readonly string[]
}

export function createSkillRetentions(deps: SkillRetentionDeps): SkillRetentions {
  const of = (botId: string, name: string): SkillRetention => {
    if (deps.store.kept(botId, name)) return { kind: "kept" }
    if (deps.jobTexts(botId).some((text) => namesSkill(text, name))) return { kind: "scheduled" }
    const at = lastActiveAt(deps.store.usage(botId, name), deps.store.versions(botId, name))
    return at === undefined
      ? { kind: "unseen" }
      : { kind: "unused", archivesAt: at + UNUSED_ARCHIVE_MS }
  }
  return {
    of,
    due: (botId, names, now) =>
      names.filter((name) => {
        const retention = of(botId, name)
        return retention.kind === "unused" && retention.archivesAt <= now
      }),
  }
}
