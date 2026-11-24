import type { BotOverlay, BotTemplate, PluginRow } from "../../shared/preset"

/** What bot-core hands to `agentPresets.register()`. */
export interface ComposedPreset {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly order: number
  readonly plugins: readonly PluginRow[]
}

/** A composed preset's identity and display fields, without its rows. */
export type PresetHead = Omit<ComposedPreset, "plugins">

/** The environment's part of a bot's preset: its rows go first in the isolated `bot-environment` group. */
export interface EnvironmentLayer {
  /** For diagnostics. */
  readonly id: string
  /** Service names its rows provide; the group isolates each. */
  readonly isolate: readonly string[]
  /** `BotEnvironment.rows(target)`; ids start with `env-`. */
  readonly rows: readonly PluginRow[]
}

/** Keys a composition's revision (its digest without bot-core's files row) into the token that row carries. */
export type Seal = (revision: string) => string

/** What every bot's web lookup can offer: the backend and which capabilities its tool-web rows may register. */
export interface WebComposition {
  readonly backend: string
  readonly search: boolean
  readonly fetch: boolean
}

export interface CompositionInput {
  readonly botId: string
  readonly botName: string
  readonly template: BotTemplate
  readonly overlay: BotOverlay
  /** Host (global) tools a template may grant through `hostTools`. */
  readonly allowedHostTools: ReadonlySet<string>
  readonly web: WebComposition
}

export interface BotPresetInput extends CompositionInput {
  readonly environment: EnvironmentLayer
  readonly seal: Seal
}

export interface CompositionProblem {
  readonly ok: false
  readonly problem: string
}

/** A template with the bot's overlay applied and validated, outside any environment: never registered. */
export interface RowsComposition {
  readonly ok: true
  readonly head: PresetHead
  readonly rows: readonly PluginRow[]
  /** Sorted, deduplicated `hostTools` of the template. */
  readonly hostTools: readonly string[]
}

/** The preset bot-core registers for a bot. */
export interface BotPresetComposition {
  readonly ok: true
  readonly preset: ComposedPreset
  readonly hostTools: readonly string[]
  /** Stable digest of `preset` and `hostTools`; equal digests mean nothing to re-register. */
  readonly digest: string
  /** The token of bot-core's files row: the `botFiles` Remote accepts that row's services with the registered revision's token only. */
  readonly revisionToken: string
}

export type RowsResult = RowsComposition | CompositionProblem

export type BotPresetResult = BotPresetComposition | CompositionProblem

/** Registered templates. Pure in-memory bookkeeping; mounts nothing. */
export interface TemplateCatalog {
  /** Validate and add a template. Throws on an invalid template or a duplicate id. */
  register(template: BotTemplate): () => void
  get(id: string): BotTemplate | undefined
  /** Sorted by id. */
  list(): readonly BotTemplate[]
  /** Called with the template id after every register or unregister. */
  subscribe(listener: (templateId: string) => void): () => void
}
