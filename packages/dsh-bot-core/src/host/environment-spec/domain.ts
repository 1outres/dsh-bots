import { z } from "zod"

const count = z.number().int().positive()

/**
 * One bot's environment spec, keyed by bot id (docs/specs/bot-vm-spec.md).
 * `origin` says how it was first stored: `default` for a new bot (or one
 * stored before specs that had no environment yet), `inspected` for a bot
 * stored before specs, from what its environment ran with; `configured`
 * once a person saved it.
 */
export const environmentSpecRecordSchema = z.object({
  spec: z.strictObject({ cpus: count, memoryMiB: count, diskGiB: count }),
  origin: z.enum(["default", "inspected", "configured"]),
  updatedAt: z.number().int().nonnegative(),
})

export type EnvironmentSpecRecord = z.infer<typeof environmentSpecRecordSchema>

/** bot-core's per-bot environment specs, apart from the bot records (design rule 27). */
export const ENVIRONMENT_SPECS_DOMAIN = {
  name: "dsh_bot_environment_specs",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    specs: { valueSchema: environmentSpecRecordSchema },
  },
} as const
