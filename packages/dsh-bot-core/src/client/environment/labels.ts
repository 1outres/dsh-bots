import type { BotEnvironmentSpecKey } from "../../shared/environment"
import type { MessageKey } from "../i18n"
import type { Translate } from "../types"

const VALUE: { readonly [Key in BotEnvironmentSpecKey]: MessageKey } = {
  cpus: "environment.value.cpus",
  memoryMiB: "environment.value.gib",
  diskGiB: "environment.value.gib",
}

export function environmentValueText(t: Translate, key: BotEnvironmentSpecKey, value: number) {
  const shown = key === "memoryMiB" ? Math.round((value / 1024) * 10) / 10 : value
  return t(VALUE[key], { value: shown })
}

export const ENVIRONMENT_KEY_LABEL: { readonly [Key in BotEnvironmentSpecKey]: MessageKey } = {
  cpus: "environment.cpus",
  memoryMiB: "environment.memory",
  diskGiB: "environment.disk",
}
