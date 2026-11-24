// The one place that builds "bot-" ids; every property readonly.
export interface BotTemplate {
  readonly id: string
  readonly plugins: readonly unknown[]
  readonly [field: string]: unknown
}
export type Row = { readonly id: string; m(): void }
export function botPresetId(botId: string): string {
  return `bot-${botId}`
}
