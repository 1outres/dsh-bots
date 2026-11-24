import type { BotDeliveryMode } from "../../contract"

/**
 * DSH's composer preference for a plain Enter while a turn runs: the
 * `busyEnter` field of the `ui-conversation` entry
 * (dsh-client-ui-conversation `submission-settings.ts`), read through the
 * Settings service as the browser's config form reads it.
 */
export const CONVERSATION_SETTINGS_ENTRY = "ui-conversation"
/** dsh-client-ui-conversation's `DEFAULT_BUSY_ENTER_BEHAVIOR`: what the composer uses without a stored preference. */
export const DEFAULT_BUSY_MODE: BotDeliveryMode = "queue"

/** One entry of the Settings service's `describe()`, as far as read here. */
export interface SettingsForm {
  readonly ns: string
  readonly value: unknown
}

/** The busy-Enter mode the composer would use with these forms. */
export function busyModeOf(forms: readonly SettingsForm[]): BotDeliveryMode {
  const form = forms.find((entry) => entry.ns === CONVERSATION_SETTINGS_ENTRY)
  const value = form?.value as { readonly busyEnter?: unknown } | undefined
  return value?.busyEnter === "steer" || value?.busyEnter === "queue"
    ? value.busyEnter
    : DEFAULT_BUSY_MODE
}
