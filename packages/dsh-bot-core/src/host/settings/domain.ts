import { z } from "zod"

const text = z.object({ en: z.string(), ja: z.string().optional() })

const json = z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(z.string())])

const value = z.object({ raw: json, shown: text })

export const settingChangeRecordSchema = z.object({
  id: z.string().min(1),
  botId: z.string().min(1),
  at: z.number(),
  area: z.string().min(1),
  areaLabel: text,
  location: text,
  items: z.array(z.object({ key: z.string().min(1), label: text, before: value, after: value })),
  reason: z.string(),
  approvedBy: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("web") }),
      z.object({ kind: z.literal("channel"), channelId: z.string(), channelName: z.string() }),
    ])
    .optional(),
  sessionId: z.string(),
  revertedAt: z.number().optional(),
})

export const SETTINGS_DOMAIN = {
  name: "dsh_bot_settings",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    changes: { valueSchema: settingChangeRecordSchema },
  },
} as const
