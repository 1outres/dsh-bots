import { z } from "zod"
import { SKILL_OPERATIONS } from "../../shared/skills"

const originSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("conversation"), sessionId: z.string().min(1) }),
  z.object({ kind: z.literal("review"), sessionId: z.string().min(1) }),
  z.object({ kind: z.literal("owner") }),
  z.object({ kind: z.literal("files") }),
  z.object({ kind: z.literal("curator") }),
])

const versionSchema = z.object({
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
  operation: z.enum(SKILL_OPERATIONS),
  reason: z.string().optional(),
  origin: originSchema,
  archived: z.boolean(),
  absorbedInto: z.string().optional(),
  files: z.array(z.object({ path: z.string().min(1), text: z.string() })),
})

/** One skill's history, keyed by {@link skillKey}: its latest versions, newest first. */
export const skillHistorySchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1),
  versions: z.array(versionSchema),
})

/** How often a skill was loaded, keyed by {@link skillKey}. */
export const skillUsageSchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1),
  uses: z.number().int().nonnegative(),
  lastUsedAt: z.number().int().nonnegative(),
})

/**
 * A bot's skill settings, keyed by bot id. `skillCurator` came with version 2;
 * a version 1 record has none, and the curation runs for it.
 */
export const skillSettingsSchema = z.object({
  skillReview: z.boolean(),
  skillCurator: z.boolean().optional(),
})

/** The owner's mark on a skill, keyed by {@link skillKey}: the curation never archives it. Absent: not kept. */
export const skillMarkSchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1),
  keep: z.literal(true),
})

/** When the curation of a bot's skills last ran, keyed by bot id; restarts keep counting from it. */
export const skillCurationSchema = z.object({
  /** The daily archive of unused skills. */
  sweptAt: z.number().int().nonnegative().optional(),
  /** The weekly curation by the model. */
  curatedAt: z.number().int().nonnegative().optional(),
})

export type StoredSkillVersion = z.infer<typeof versionSchema>
export type SkillHistoryRecord = z.infer<typeof skillHistorySchema>
export type SkillUsageRecord = z.infer<typeof skillUsageSchema>
export type SkillSettingsRecord = z.infer<typeof skillSettingsSchema>
export type SkillMarkRecord = z.infer<typeof skillMarkSchema>
export type SkillCurationRecord = z.infer<typeof skillCurationSchema>

/** The key of a skill's history and usage. */
export const skillKey = (botId: string, name: string): string => `${botId}:${name}`

/**
 * Every bot's skill history, skill usage, skill settings, the owner's marks
 * and when the curation last ran (docs/specs/bot-skills.md §4, §12). Version 2
 * added the origin `curator`, the setting `skillCurator` and the tables
 * `marks` and `curation`; every version 1 unit is a valid version 2 unit,
 * hence `compatibleVersions`.
 */
export const SKILLS_DOMAIN = {
  name: "dsh_bot_skills",
  version: 2,
  compatibleVersions: [1],
  invalidRecords: "backup-and-skip",
  tables: {
    history: { valueSchema: skillHistorySchema },
    usage: { valueSchema: skillUsageSchema },
    settings: { valueSchema: skillSettingsSchema },
    marks: { valueSchema: skillMarkSchema },
    curation: { valueSchema: skillCurationSchema },
  },
} as const
