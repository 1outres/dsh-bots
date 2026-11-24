import { z } from "zod"

const choiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile-default") }),
  z.object({
    kind: z.literal("fixed"),
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1).optional(),
  }),
])

/**
 * One bot's models, keyed by bot id. Each role is optional when read, so a
 * role added later is filled with its default at start-up (store.ts);
 * whether a fixed route still runs is checked where it is used, not here.
 */
export const botModelsRecordSchema = z.object({
  roles: z.object({
    main: choiceSchema.optional(),
    utility: choiceSchema.optional(),
    delegates: z.array(choiceSchema).optional(),
  }),
  /** Set while the Main session has not taken the stored `main` yet. */
  mainPending: z.literal(true).optional(),
  updatedAt: z.number().int().nonnegative(),
})

export type BotModelsRecord = z.infer<typeof botModelsRecordSchema>

/** bot-core's per-bot model roles (docs/specs/bot-models.md). */
export const MODELS_DOMAIN = {
  name: "dsh_bot_models",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    models: { valueSchema: botModelsRecordSchema },
  },
} as const
