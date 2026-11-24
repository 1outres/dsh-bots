/**
 * Bot preset model: templates, per-bot overlays and the identity of the
 * Agent preset bot-core composes from them. Pure data shared by the Host
 * modules; nothing here touches DSH services.
 */

/**
 * One Cordis plugin row as a preset plugin list carries it. Unlike a plain
 * preset row, a template row must carry an `id` so an overlay can target it.
 */
export interface PluginRow {
  readonly id: string
  /** Plugin package specifier, e.g. "@deepseek-ai/dsh-tool-fs". */
  readonly name: string
  readonly config?: unknown
  readonly disabled?: unknown
  readonly group?: boolean
  readonly inject?: unknown
  readonly isolate?: Readonly<Record<string, boolean | string>>
  readonly [field: string]: unknown
}

/**
 * The base a bot's Agent preset is composed from. Registering a template
 * mounts nothing: only the per-bot presets composed from it are activated.
 */
export interface BotTemplate {
  /** Stable id, lowercase letters, digits and hyphens. */
  readonly id: string
  readonly name?: string
  readonly description?: string
  /** Preset plugin rows; every row (nested group rows included) has a unique `id`. */
  readonly plugins: readonly PluginRow[]
  /**
   * Host-level (global) tools a bot Agent may still see, by exact tool name.
   * Every other global tool is hidden from bot Agents (subagents included),
   * also one registered later; tools contributed by the composed preset itself
   * stay visible. Hiding works by name: a preset tool that shares its name
   * with a global tool is hidden too unless that name is listed here.
   */
  readonly hostTools?: readonly string[]
}

/**
 * One edit a bot applies to its template, addressed by top-level row id.
 * - `add` inserts a row (at the end, or right after the row `after`).
 * - `replace` swaps the row with that id for `row`, which keeps the same id.
 * - `remove` drops the row with that id.
 */
export type OverlayOp =
  | { readonly op: "add"; readonly row: PluginRow; readonly after?: string }
  | { readonly op: "replace"; readonly id: string; readonly row: PluginRow }
  | { readonly op: "remove"; readonly id: string }

export type BotOverlay = readonly OverlayOp[]

/** Outcome of checking a preset change without storing it. */
export type BotPresetPreview =
  | { readonly ok: true; readonly template: string; readonly hostTools: readonly string[] }
  | { readonly ok: false; readonly template: string; readonly problem: string }

/** Template used when a bot names none. bot-core always registers it. */
export const DEFAULT_TEMPLATE_ID = "default"

/** Prefix of every Agent preset id bot-core registers. */
export const BOT_PRESET_PREFIX = "bot-"

/**
 * Start of every bot preset's `description`. The browser half recognizes bot
 * presets in the composer's preset menu by it: that menu carries no preset id.
 */
export const BOT_PRESET_DESCRIPTION_PREFIX = "Agent preset of bot "

/**
 * Agent preset id of a bot. Derived, never stored: session logs record it,
 * so a bot keeps resuming its sessions across template and overlay edits.
 */
export function botPresetId(botId: string): string {
  return `${BOT_PRESET_PREFIX}${botId}`
}

/**
 * Bot id of a bot preset id, or `undefined` for any other preset. The
 * inverse of {@link botPresetId}; the prefix alone does not prove that the
 * bot exists.
 */
export function botIdOfPreset(presetId: string): string | undefined {
  if (!presetId.startsWith(BOT_PRESET_PREFIX)) return undefined
  const botId = presetId.slice(BOT_PRESET_PREFIX.length)
  return botId === "" ? undefined : botId
}

/** Whether a bot's composed preset can compose sessions right now. */
export type BotPresetState = (
  | { readonly id: string; readonly ready: true; readonly template: string }
  | {
      readonly id: string
      readonly ready: false
      readonly template: string
      readonly problem: string
      /**
       * Set while the cause is expected to clear by itself: the bot's template
       * is not registered yet (a template row mounts after bot-core), no bot
       * environment is registered yet, or it is still being prepared for the
       * bot. The preset is not registered meanwhile either.
       */
      readonly pending?: true
    }
) & {
  /**
   * Set when the bot's Main session predates bot presets: that Main runs the
   * deployment's default Agent preset, without the bot's composition or tool
   * isolation, and keeps it (a started session's preset is fixed). Sessions
   * from `Bot.createSession` are unaffected. Nothing migrates it
   * automatically.
   */
  readonly legacyMain?: true
}
