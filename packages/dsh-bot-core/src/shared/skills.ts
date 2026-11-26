export type SkillOrigin =
  | { readonly kind: "conversation"; readonly sessionId: string }
  | { readonly kind: "review"; readonly sessionId: string }
  | { readonly kind: "owner" }
  | { readonly kind: "files" }
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

export interface SkillFile {
  readonly path: string
  readonly text: string
}

export interface SkillVersionSummary {
  readonly id: string
  readonly at: number
  readonly operation: SkillOperation
  readonly reason?: string
  readonly origin: SkillOrigin
  readonly archived: boolean
  readonly absorbedInto?: string
}

export interface SkillVersion extends SkillVersionSummary {
  readonly files: readonly SkillFile[]
}

export type SkillRetention =
  | { readonly kind: "kept" }
  | { readonly kind: "scheduled" }
  | { readonly kind: "unused"; readonly archivesAt: number }
  | { readonly kind: "unseen" }

export interface BotSkillSummary {
  readonly name: string
  readonly description: string
  readonly archived: boolean
  readonly keep: boolean
  readonly retention?: SkillRetention
  readonly uses: number
  readonly lastUsedAt?: number
  readonly versions: number
}

export interface InvalidSkill {
  readonly path: string
  readonly problem: string
}

export interface BotSkillsView {
  readonly botId: string
  readonly review: boolean
  readonly curator: boolean
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
  readonly versions: readonly SkillVersionSummary[]
}

export const SKILL_VERSION_LIMIT = 20

export interface BotSkillsApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotSkillsView>
  history(botId: string, name: string): Promise<BotSkillHistory>
  version(botId: string, name: string, versionId: string): Promise<SkillVersion>
  restoreVersion(botId: string, name: string, versionId: string): Promise<BotSkillHistory>
  restoreArchived(botId: string, name: string): Promise<BotSkillHistory>
  setReview(botId: string, enabled: boolean): Promise<BotSkillsView>
  setCurator(botId: string, enabled: boolean): Promise<BotSkillsView>
  setKeep(botId: string, name: string, keep: boolean): Promise<BotSkillsView>
}
