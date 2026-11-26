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

export const botModelsRecordSchema = z.object({
  roles: z.object({
    main: choiceSchema.optional(),
    utility: choiceSchema.optional(),
    delegates: z.array(choiceSchema).optional(),
  }),
  mainPending: z.literal(true).optional(),
  updatedAt: z.number().int().nonnegative(),
})

export type BotModelsRecord = z.infer<typeof botModelsRecordSchema>

export const MODELS_DOMAIN = {
  name: "dsh_bot_models",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    models: { valueSchema: botModelsRecordSchema },
  },
} as const
