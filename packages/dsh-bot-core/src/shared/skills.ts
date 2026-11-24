/**
 * A bot's skills as the Web UI reads and changes them (docs/specs/bot-skills.md
 * §4, §5, §12): the skills in its workspace's skills/, the history of each,
 * which ones the owner keeps from being archived, and whether the background
 * skill review and the skill curation run.
 */

/** Who made a version. */
export type SkillOrigin =
  /** The bot, in a conversation with its owner (a Main or Web session). */
  | { readonly kind: "conversation"; readonly sessionId: string }
  /** The background review of that session's conversation. */
  | { readonly kind: "review"; readonly sessionId: string }
  /** The owner, in the Web UI. */
  | { readonly kind: "owner" }
  /** Found in the files, changed outside skill_manage (the bot's bash, by hand). */
  | { readonly kind: "files" }
  /** The skill curation: the daily archive of unused skills, or the weekly tidy-up by the model. */
  | { readonly kind: "curator" }

export const SKILL_OPERATIONS = [
  "create",
  "patch",
  "write_file",
  "remove_file",
  "archive",
  "restore",
  "observed",
] as const

export type SkillOperation = (typeof SKILL_OPERATIONS)[number]

/** One file of a skill's directory, relative to it (`SKILL.md`, `references/…`). */
export interface SkillFile {
  readonly path: string
  readonly text: string
}

/** One version of a skill, without its files. */
export interface SkillVersionSummary {
  readonly id: string
  readonly at: number
  readonly operation: SkillOperation
  readonly reason?: string
  readonly origin: SkillOrigin
  /** Archived in this version (its files under skills/.archive/). */
  readonly archived: boolean
  /** With archive: the skill it was merged into. */
  readonly absorbedInto?: string
}

/** One version with the skill's whole directory as it was then. */
export interface SkillVersion extends SkillVersionSummary {
  readonly files: readonly SkillFile[]
}

/**
 * Whether the daily curation archives an active skill, and when: never while
 * the owner keeps it or an enabled schedule job names it; `unseen` until the
 * curation first records it (a skill placed by hand, never used).
 */
export type SkillRetention =
  | { readonly kind: "kept" }
  | { readonly kind: "scheduled" }
  | { readonly kind: "unused"; readonly archivesAt: number }
  | { readonly kind: "unseen" }

/** One skill of the bot, active or archived. */
export interface BotSkillSummary {
  readonly name: string
  readonly description: string
  readonly archived: boolean
  /** The owner's mark: the curation never archives it (`keep`). */
  readonly keep: boolean
  /** Active skills only. */
  readonly retention?: SkillRetention
  /** Times the skill was loaded (the `skill` tool, a user's /name). */
  readonly uses: number
  readonly lastUsedAt?: number
  /** Versions kept (at most {@link SKILL_VERSION_LIMIT}). */
  readonly versions: number
}

/** A file of skills/ that is not a valid skill, and why. */
export interface InvalidSkill {
  readonly path: string
  readonly problem: string
}

export interface BotSkillsView {
  readonly botId: string
  /** The background skill review runs after conversations (`skillReview`). */
  readonly review: boolean
  /** The weekly skill curation by the model runs (`skillCurator`). */
  readonly curator: boolean
  /** The skills as last read from the bot's environment; unavailable while it cannot be read. */
  readonly library:
    | { readonly state: "loading" }
    | {
        readonly state: "ready"
        readonly skills: readonly BotSkillSummary[]
        readonly invalid: readonly InvalidSkill[]
      }
    | { readonly state: "unavailable"; readonly message: string }
}

export interface BotSkillHistory {
  readonly name: string
  /** Newest first. */
  readonly versions: readonly SkillVersionSummary[]
}

/** Versions kept per skill. */
export const SKILL_VERSION_LIMIT = 20

/** The `botSkills` Remote. */
export interface BotSkillsApi {
  /** The bot's skills now, then after every change (re-read from its environment when the watch starts). */
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotSkillsView>
  /** @throws for an unknown bot. */
  history(botId: string, name: string): Promise<BotSkillHistory>
  /** One version with its files. @throws when it is not kept. */
  version(botId: string, name: string, versionId: string): Promise<SkillVersion>
  /** Put the skill back as it was in that version, as a new version of origin owner. */
  restoreVersion(botId: string, name: string, versionId: string): Promise<BotSkillHistory>
  /** Bring an archived skill back. */
  restoreArchived(botId: string, name: string): Promise<BotSkillHistory>
  setReview(botId: string, enabled: boolean): Promise<BotSkillsView>
  setCurator(botId: string, enabled: boolean): Promise<BotSkillsView>
  /** Mark a skill (active or archived) so the curation never archives it, or clear the mark. */
  setKeep(botId: string, name: string, keep: boolean): Promise<BotSkillsView>
}
