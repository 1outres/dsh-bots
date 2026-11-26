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

export const skillHistorySchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1),
  versions: z.array(versionSchema),
})

export const skillUsageSchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1),
  uses: z.number().int().nonnegative(),
  lastUsedAt: z.number().int().nonnegative(),
})

export const skillSettingsSchema = z.object({
  skillReview: z.boolean(),
  skillCurator: z.boolean().optional(),
})

export const skillMarkSchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1),
  keep: z.literal(true),
})

export const skillCurationSchema = z.object({
  sweptAt: z.number().int().nonnegative().optional(),
  curatedAt: z.number().int().nonnegative().optional(),
})

export type StoredSkillVersion = z.infer<typeof versionSchema>
export type SkillHistoryRecord = z.infer<typeof skillHistorySchema>
export type SkillUsageRecord = z.infer<typeof skillUsageSchema>
export type SkillSettingsRecord = z.infer<typeof skillSettingsSchema>
export type SkillMarkRecord = z.infer<typeof skillMarkSchema>
export type SkillCurationRecord = z.infer<typeof skillCurationSchema>

export const skillKey = (botId: string, name: string): string => `${botId}:${name}`

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
