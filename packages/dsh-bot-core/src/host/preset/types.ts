import type { BotOverlay, BotTemplate, PluginRow } from "../../shared/preset"

export interface ComposedPreset {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly order: number
  readonly plugins: readonly PluginRow[]
}

export type PresetHead = Omit<ComposedPreset, "plugins">

export interface EnvironmentLayer {
  readonly id: string
  readonly isolate: readonly string[]
  readonly rows: readonly PluginRow[]
}

export type Seal = (revision: string) => string

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

export interface RowsComposition {
  readonly ok: true
  readonly head: PresetHead
  readonly rows: readonly PluginRow[]
  readonly hostTools: readonly string[]
}

export interface BotPresetComposition {
  readonly ok: true
  readonly preset: ComposedPreset
  readonly hostTools: readonly string[]
  readonly digest: string
  readonly revisionToken: string
}

export type RowsResult = RowsComposition | CompositionProblem

export type BotPresetResult = BotPresetComposition | CompositionProblem

export interface TemplateCatalog {
  register(template: BotTemplate): () => void
  get(id: string): BotTemplate | undefined
  list(): readonly BotTemplate[]
  subscribe(listener: (templateId: string) => void): () => void
}
