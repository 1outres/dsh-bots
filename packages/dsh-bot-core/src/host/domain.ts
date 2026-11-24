import { z } from "zod"
import { CREATION_PHASES } from "../shared/bots"
import { MAIN_ROTATION_REASONS } from "../shared/mains"
import type { BotOverlay } from "../shared/preset"
import { overlayPluginProblem } from "./preset/compose"

/** Version of the initial workspace files bot-core places (host/workspace-files.ts); a new set gets the next. */
export const WORKSPACE_FILES_VERSION = 1
export type WorkspaceFilesVersion = typeof WORKSPACE_FILES_VERSION

/** Version of the initial notes bot-core places (host/notes/initial.ts); a new set gets the next. */
export const INITIAL_NOTES_VERSION = 1
export type InitialNotesVersion = typeof INITIAL_NOTES_VERSION

const avatarSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("emoji"), emoji: z.string().min(1), color: z.string() }),
  z.object({ kind: z.literal("initial"), text: z.string().min(1), color: z.string() }),
  z.object({ kind: z.literal("image"), dataUrl: z.string() }),
])

/**
 * One overlay row as accepted from outside: an `id`, a plugin `name` and any
 * other row fields, all JSON. Row structure beyond that (groups, nested ids)
 * is checked when the preset is composed, against the template it applies to.
 */
const overlayRowSchema = z
  .object({ id: z.string().min(1), name: z.string().min(1) })
  .catchall(z.json())

/** One overlay op; unknown fields are refused so a typo never passes as a no-op. */
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

/** A bot's overlay as `configurePreset` accepts it. */
export const botOverlaySchema = z.array(overlayOpSchema)

/**
 * Stored shape of one bot.
 *
 * `template`, `overlay` and `mainOnBotPreset` came with bot presets and are
 * optional, so records written before them still parse: an absent template
 * is the `default` one, an absent overlay is empty.
 *
 * `path` and `workspaceId` are legacy (domain version 1): a bot used to own a
 * Host directory registered as a DSH Workspace. Bots now run only in their
 * environment's workspace and their sessions are recorded in the `sessions`
 * table, so new records carry neither; an old record still parses, and its
 * Workspace registration is retired at start-up (its sessions are recorded).
 *
 * The preset fields are stored loosely on purpose. The store refuses a whole
 * record it cannot parse (`backup-and-skip`), which would drop the bot; a
 * template or overlay that no longer validates (a later version's op, a
 * stricter rule) must instead leave the bot listed with a preset that is not
 * ready and says why. Strict checks happen where values enter
 * (`parseOverlay`) and where they are used (composition).
 */
export const botRecordSchema = z.object({
  name: z.string().min(1),
  avatar: avatarSchema,
  /** Legacy: the bot's former Host directory. Read, never written. */
  path: z.string().min(1).optional(),
  /** Legacy: the Workspace registered for {@link path}, retired at start-up. Never written. */
  workspaceId: z.string().min(1).optional(),
  mainSessionId: z.string().min(1).optional(),
  /** Template the bot's preset is composed from; absent means `default`. */
  template: z.string().optional(),
  /** Edits the bot applies to its template, as JSON; absent means none. */
  overlay: z.array(z.json()).optional(),
  /**
   * Set when the Main session was created under the bot's own preset. Absent
   * on a bot whose Main predates bot presets: that Main runs the deployment's
   * default preset, and a session's preset cannot change once it started.
   */
  mainOnBotPreset: z.literal(true).optional(),
  /** Earlier name of {@link mainOnBotPreset} (the preset id); still read, no longer written. */
  mainPreset: z.string().min(1).optional(),
  /**
   * Why the creation (no Main session yet) stopped, and at which step. A bot
   * with it is not prepared again until the creation is retried.
   */
  creationFailure: z
    .object({
      phase: z.enum(CREATION_PHASES),
      message: z.string(),
      at: z.number().int().nonnegative(),
    })
    .optional(),
  /**
   * The bot's IANA time zone (its schedule jobs' default, its channel turns'
   * zone). Written with every new bot, as its creator chose it (the browser's
   * zone unless changed); a bot stored before it ran in the Host's zone and
   * got that one stored at start-up.
   */
  timezone: z.string().min(1).optional(),
  /**
   * The language the bot greets in (BCP 47). Stored with every new bot; a bot
   * stored before it has none until its owner chooses one.
   */
  language: z.string().min(1).optional(),
  /** Version of the initial workspace files (AGENTS.md, SOUL.md) once they were placed. */
  workspaceFiles: z.literal(WORKSPACE_FILES_VERSION).optional(),
  /** Version of the initial notes (the pinned Owner and Now) once they were placed. */
  initialNotes: z.literal(INITIAL_NOTES_VERSION).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type BotRecord = z.infer<typeof botRecordSchema>

/**
 * One session of a bot, keyed by session id: bot-core's own membership
 * record, in place of a Workspace's session list (bot sessions run in the
 * environment's workspace, which no Host Workspace can hold). The Main
 * session is recorded here too.
 */
export const botSessionSchema = z.object({
  botId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  /** The bot's Main session started it (`session_start`); written with the record, never changed. */
  startedBy: z.literal("main").optional(),
  /** Set once the session was the bot's Main and a new Main took its place. */
  retiredMain: z
    .object({
      endedAt: z.number().int().nonnegative(),
      reason: z.enum(MAIN_ROTATION_REASONS),
    })
    .optional(),
})

export type BotSessionRecord = z.infer<typeof botSessionSchema>

/** What a session's membership record says besides its bot. */
export type SessionMembership = Pick<BotSessionRecord, "startedBy">

/** Whether the bot's Main session runs under the bot's own preset. */
export function mainOnBotPreset(record: BotRecord): boolean {
  return record.mainOnBotPreset === true || record.mainPreset !== undefined
}

/** The first `{ __jsExpr }` node (a Loader `!!js` expression) inside `value`, as a path. */
function expressionAt(value: unknown, path: string[] = []): string[] | undefined {
  if (typeof value !== "object" || value === null) return undefined
  if (!Array.isArray(value) && Object.hasOwn(value, "__jsExpr")) return path
  for (const [key, field] of Object.entries(value)) {
    const found = expressionAt(field, [...path, key])
    if (found !== undefined) return found
  }
  return undefined
}

/** Where an overlay comes from, which decides how far it is trusted. */
export type OverlaySource =
  /**
   * From outside (a channel plugin passing on a chat message, the browser):
   * no Loader `!!js` expressions, and plugin names only from `allowedPlugins`
   * (never paths, URLs or include rows). The Loader imports a row's `name` and
   * evaluates `!!js` on the Host, so either would run arbitrary code there.
   */
  | { readonly trusted?: false; readonly allowedPlugins: ReadonlySet<string> }
  /** Already stored: it passed the outside checks when it was configured. */
  | { readonly trusted: true }

/**
 * Parse an overlay. The trust boundary is the profile: templates declared in
 * it may use `!!js` and any plugin package (but nothing that escapes the bot
 * environment, checked at composition); an overlay from outside may not.
 * @throws {Error} naming the first offending op.
 */
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

/**
 * Durable bot records keyed by bot id, and bot sessions keyed by session id.
 *
 * Version 2 added the `sessions` table and made `path` / `workspaceId`
 * optional; every version 1 unit is a valid version 2 unit (no sessions yet,
 * so a legacy bot's sessions are recorded from its Workspace at start-up),
 * hence `compatibleVersions`. A version 1 bot-core refuses a version 2 unit.
 */
export const BOTS_DOMAIN = {
  name: "dsh_bots",
  version: 2,
  compatibleVersions: [1],
  invalidRecords: "backup-and-skip",
  tables: {
    bots: { valueSchema: botRecordSchema },
    sessions: { valueSchema: botSessionSchema },
  },
} as const
