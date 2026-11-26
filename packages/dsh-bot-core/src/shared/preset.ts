export interface PluginRow {
  readonly id: string
  readonly name: string
  readonly config?: unknown
  readonly disabled?: unknown
  readonly group?: boolean
  readonly inject?: unknown
  readonly isolate?: Readonly<Record<string, boolean | string>>
  readonly [field: string]: unknown
}

export interface BotTemplate {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly plugins: readonly PluginRow[]
  readonly hostTools?: readonly string[]
}

export type OverlayOp =
  | { readonly op: "add"; readonly row: PluginRow; readonly after?: string }
  | { readonly op: "replace"; readonly id: string; readonly row: PluginRow }
  | { readonly op: "remove"; readonly id: string }

export type BotOverlay = readonly OverlayOp[]

export type BotPresetPreview =
  | { readonly ok: true; readonly template: string; readonly hostTools: readonly string[] }
  | { readonly ok: false; readonly template: string; readonly problem: string }

export const DEFAULT_TEMPLATE_ID = "default"

export const BOT_PRESET_PREFIX = "bot-"

export const BOT_PRESET_DESCRIPTION_PREFIX = "Agent preset of bot "

export function botPresetId(botId: string): string {
  return `${BOT_PRESET_PREFIX}${botId}`
}

export function botIdOfPreset(presetId: string): string | undefined {
  if (!presetId.startsWith(BOT_PRESET_PREFIX)) return undefined
  const botId = presetId.slice(BOT_PRESET_PREFIX.length)
  return botId === "" ? undefined : botId
}

export type BotPresetState = (
  | { readonly id: string; readonly ready: true; readonly template: string }
  | {
      readonly id: string
      readonly ready: false
      readonly template: string
      readonly problem: string
      readonly pending?: true
    }
) & {
  readonly legacyMain?: true
}
