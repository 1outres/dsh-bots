/**
 * Which active skills the daily curation archives (docs/specs/bot-skills.md
 * §12.1): those neither loaded nor changed for {@link UNUSED_ARCHIVE_MS},
 * unless the owner keeps them or an armed schedule job of the bot names them.
 */
import type { SkillRetention } from "../../shared/skills"
import type { StoredSkillVersion } from "./domain"
import type { SkillStore, SkillUsage } from "./store"

export const DAY_MS = 24 * 60 * 60_000
export const UNUSED_ARCHIVE_DAYS = 30
export const UNUSED_ARCHIVE_MS = UNUSED_ARCHIVE_DAYS * DAY_MS
/** The reason of the archive's version, shown in the skill history. */
export const UNUSED_ARCHIVE_REASON = `Unused for ${UNUSED_ARCHIVE_DAYS} days`

const WORD = "A-Za-z0-9_-"

/** Whether `text` names the skill as a whole word: not as part of a longer kebab-case name. */
export function namesSkill(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![${WORD}])${escaped}(?![${WORD}])`, "i").test(text)
}

/** The later of the skill's last load and its latest version, or undefined when it has neither. */
export function lastActiveAt(
  usage: SkillUsage,
  versions: readonly StoredSkillVersion[],
): number | undefined {
  const times = [usage.lastUsedAt, versions[0]?.at].filter((at): at is number => at !== undefined)
  return times.length === 0 ? undefined : Math.max(...times)
}

export interface SkillRetentionDeps {
  store: Pick<SkillStore, "kept" | "usage" | "versions">
  /** The instruction and check command of each armed schedule job of the bot. */
  jobTexts(botId: string): readonly string[]
}

export interface SkillRetentions {
  /** What keeps an active skill, or when it is archived. */
  of(botId: string, name: string): SkillRetention
  /** The active skills among `names` that are due to be archived at `now`. */
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
