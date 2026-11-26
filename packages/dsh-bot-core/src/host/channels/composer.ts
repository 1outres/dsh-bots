import type { BotDeliveryMode } from "../../contract"

export const CONVERSATION_SETTINGS_ENTRY = "ui-conversation"
export const DEFAULT_BUSY_MODE: BotDeliveryMode = "queue"

export interface SettingsForm {
  readonly ns: string
  readonly value: unknown
}

export function busyModeOf(forms: readonly SettingsForm[]): BotDeliveryMode {
  const form = forms.find((entry) => entry.ns === CONVERSATION_SETTINGS_ENTRY)
  const value = form?.value as { readonly busyEnter?: unknown } | undefined
  return value?.busyEnter === "steer" || value?.busyEnter === "queue"
    ? value.busyEnter
    : DEFAULT_BUSY_MODE
}
