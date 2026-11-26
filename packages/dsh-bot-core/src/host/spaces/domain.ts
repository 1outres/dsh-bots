import { z } from "zod"

export const SPACE_SETTINGS_KEY = "global"

const json: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(json),
    z.record(z.string(), json),
  ]),
)

export const spaceRecordSchema = z.object({
  botId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  title: z.string().min(1),
  description: z.string(),
  pinned: z.boolean(),
  visibility: z.enum(["owner", "public"]),
  visitorWrites: z.boolean(),
  source: z.object({
    kind: z.literal("snapshot"),
    revision: z.number().int().positive().nullable(),
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const spaceRevisionSchema = z.object({
  number: z.number().int().positive(),
  publishedAt: z.number(),
  files: z.record(
    z.string(),
    z.object({
      blob: z.string().regex(/^[0-9a-f]{64}$/),
      bytes: z.number().int().nonnegative(),
      type: z.string().min(1),
    }),
  ),
})

export const spaceAccessRecordSchema = z.object({
  spaceId: z.string().min(1),
  kind: z.enum(["link", "public"]),
  label: z.string(),
  reason: z.string().nullable(),
  issuedBy: z.enum(["owner", "bot"]),
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  token: z.string().nullable(),
})

export const spaceKvRecordSchema = z.object({ value: json, updatedAt: z.number() })

export const spaceSettingsRecordSchema = z.object({ publicBaseUrl: z.string().nullable() })

export const SPACES_DOMAIN = {
  name: "dsh_bot_spaces",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    spaces: { valueSchema: spaceRecordSchema },
    revisions: { valueSchema: spaceRevisionSchema },
    access: { valueSchema: spaceAccessRecordSchema },
    kv: { valueSchema: spaceKvRecordSchema },
    settings: { valueSchema: spaceSettingsRecordSchema },
  },
} as const
