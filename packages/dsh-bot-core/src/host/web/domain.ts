import { z } from "zod"

/** The one row of the settings table. */
export const WEB_SETTINGS_KEY = "global"

export const webSettingsSchema = z.object({
  backend: z.string().regex(/^[a-z][a-z0-9-]*$/),
  search: z.boolean(),
  fetch: z.boolean(),
})

/** bot-core's web lookup settings, shared by every bot (design rule 27). */
export const WEB_DOMAIN = {
  name: "dsh_bot_web",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    settings: { valueSchema: webSettingsSchema },
  },
} as const
