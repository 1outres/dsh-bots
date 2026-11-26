import { z } from "zod"
import { BOT_CHARACTERS } from "../shared/avatar"
import { CREATION_PHASES } from "../shared/bots"
import { MAIN_ROTATION_REASONS } from "../shared/mains"
import type { BotOverlay } from "../shared/preset"
import { overlayPluginProblem } from "./preset/compose"

export const WORKSPACE_FILES_VERSION = 1
export type WorkspaceFilesVersion = typeof WORKSPACE_FILES_VERSION

export const INITIAL_NOTES_VERSION = 1
export type InitialNotesVersion = typeof INITIAL_NOTES_VERSION

const legacyEmojiAvatarSchema = z.object({
  kind: z.literal("emoji"),
  emoji: z.string().min(1),
  color: z.string(),
})

export type LegacyEmojiAvatar = z.infer<typeof legacyEmojiAvatarSchema>

const storedAvatarSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), character: z.enum(BOT_CHARACTERS), color: z.string() }),
  z.object({ kind: z.literal("initial"), text: z.string().min(1), color: z.string() }),
  z.object({ kind: z.literal("image"), dataUrl: z.string() }),
  legacyEmojiAvatarSchema,
])

export type StoredAvatar = z.infer<typeof storedAvatarSchema>

const overlayRowSchema = z
  .object({ id: z.string().min(1), name: z.string().min(1) })
  .catchall(z.json())

const overlayOpSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("add"),
    row: overlayRowSchema,
    after: z.string().min(1).optional(),
  }),
  z
    .strictObject({ op: z.literal("replace"), id: z.string().min(1), row: overlayRowSchema })
    .refine((op) => op.row.id === op.id, { message: "a replace op keeps the row id" }),
  z.strictObject({ op: z.literal("remove"), id: z.string().min(1) }),
])

export const botOverlaySchema = z.array(overlayOpSchema)

export const botRecordSchema = z.object({
  name: z.string().min(1),
  avatar: storedAvatarSchema,
  path: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  mainSessionId: z.string().min(1).optional(),
  template: z.string().optional(),
  overlay: z.array(z.json()).optional(),
  mainOnBotPreset: z.literal(true).optional(),
  mainPreset: z.string().min(1).optional(),
  creationFailure: z
    .object({
      phase: z.enum(CREATION_PHASES),
      message: z.string(),
      at: z.number().int().nonnegative(),
    })
    .optional(),
  timezone: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  workspaceFiles: z.literal(WORKSPACE_FILES_VERSION).optional(),
  initialNotes: z.literal(INITIAL_NOTES_VERSION).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type BotRecord = z.infer<typeof botRecordSchema>

export const botSessionSchema = z.object({
  botId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  startedBy: z.literal("main").optional(),
  retiredMain: z
    .object({
      endedAt: z.number().int().nonnegative(),
      reason: z.enum(MAIN_ROTATION_REASONS),
    })
    .optional(),
})

export type BotSessionRecord = z.infer<typeof botSessionSchema>

export type SessionMembership = Pick<BotSessionRecord, "startedBy">

export function mainOnBotPreset(record: BotRecord): boolean {
  return record.mainOnBotPreset === true || record.mainPreset !== undefined
}

function expressionAt(value: unknown, path: string[] = []): string[] | undefined {
  if (typeof value !== "object" || value === null) return undefined
  if (!Array.isArray(value) && Object.hasOwn(value, "__jsExpr")) return path
  for (const [key, field] of Object.entries(value)) {
    const found = expressionAt(field, [...path, key])
    if (found !== undefined) return found
  }
  return undefined
}

export type OverlaySource =
  | { readonly trusted?: false; readonly allowedPlugins: ReadonlySet<string> }
  | { readonly trusted: true }

export function parseOverlay(overlay: unknown, source: OverlaySource): BotOverlay {
  const parsed = botOverlaySchema.safeParse(overlay)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue?.path.length ? ` at ${issue.path.join(".")}` : ""
    throw new Error(`invalid overlay${at}: ${issue?.message ?? "malformed"}`)
  }
  if (source.trusted !== true) {
    const at = expressionAt(parsed.data)
    if (at !== undefined) {
      throw new Error(
        `invalid overlay at ${at.join(".")}: Loader expressions (!!js) are not accepted here; declare them in a template`,
      )
    }
    const plugin = overlayPluginProblem(parsed.data, source.allowedPlugins)
    if (plugin !== undefined) throw new Error(`invalid overlay: ${plugin}`)
  }
  return parsed.data
}

export const BOTS_DOMAIN = {
  name: "dsh_bots",
  version: 3,
  compatibleVersions: [1, 2],
  invalidRecords: "backup-and-skip",
  tables: {
    bots: { valueSchema: botRecordSchema },
    sessions: { valueSchema: botSessionSchema },
  },
} as const
