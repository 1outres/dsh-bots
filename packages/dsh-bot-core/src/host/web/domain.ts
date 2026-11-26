import { z } from "zod"

export const WEB_SETTINGS_KEY = "global"

export const webSettingsSchema = z.object({
  backend: z.string().regex(/^[a-z][a-z0-9-]*$/),
  search: z.boolean(),
  fetch: z.boolean(),
})

export const WEB_DOMAIN = {
  name: "dsh_bot_web",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    settings: { valueSchema: webSettingsSchema },
  },
} as const
