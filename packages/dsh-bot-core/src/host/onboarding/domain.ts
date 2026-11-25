import { z } from "zod"

/** The one row of the state table. */
export const ONBOARDING_STATE_KEY = "global"

const BOT_ID = z.string().min(1)

export const welcomeRecordSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("open") }),
  z.object({ status: z.literal("creating"), botId: BOT_ID, startedAt: z.number() }),
  z.object({
    status: z.literal("done"),
    at: z.number(),
    how: z.enum(["created", "later", "existing"]),
    botId: BOT_ID.optional(),
  }),
])

export const onboardingRecordSchema = z.object({
  welcome: welcomeRecordSchema,
  /** The newest dsh-bots version whose release notes were acknowledged or had none to show. */
  notesSeen: z.string(),
  updatedAt: z.number(),
})

export type WelcomeRecord = z.infer<typeof welcomeRecordSchema>
export type OnboardingRecord = z.infer<typeof onboardingRecordSchema>

/** The welcome guide and the release notes seen, shared by every page (design rule 27). */
export const ONBOARDING_DOMAIN = {
  name: "dsh_bot_onboarding",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    state: { valueSchema: onboardingRecordSchema },
  },
} as const
