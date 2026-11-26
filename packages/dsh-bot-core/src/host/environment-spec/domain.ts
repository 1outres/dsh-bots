import { z } from "zod"

const count = z.number().int().positive()

export const environmentSpecRecordSchema = z.object({
  spec: z.strictObject({ cpus: count, memoryMiB: count, diskGiB: count }),
  origin: z.enum(["default", "inspected", "configured"]),
  updatedAt: z.number().int().nonnegative(),
})

export type EnvironmentSpecRecord = z.infer<typeof environmentSpecRecordSchema>

export const ENVIRONMENT_SPECS_DOMAIN = {
  name: "dsh_bot_environment_specs",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    specs: { valueSchema: environmentSpecRecordSchema },
  },
} as const
