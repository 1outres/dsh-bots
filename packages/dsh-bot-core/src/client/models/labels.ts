import type { BotModelsErrorCode } from "../../shared/models"
import type { MessageKey } from "../i18n"
import type { Translate } from "../types"
import type { Choice } from "../ui"
import type { ModelsFailure } from "./feed"
import {
  DEFAULT_EFFORT,
  defaultEffortName,
  type EffortOption,
  effortOptions,
  type ModelMenu,
  type ModelOption,
} from "./menu"

export function optionLabel(t: Translate, menu: ModelMenu, option: ModelOption): string {
  if (option.kind === "fixed") return option.model.name
  return menu.profileDefault === undefined
    ? t("models.profileDefault")
    : t("models.profileDefaultNamed", { model: menu.profileDefault.model.name })
}

export function optionProvider(menu: ModelMenu, option: ModelOption): string | undefined {
  return option.kind === "fixed" ? option.provider.name : menu.profileDefault?.provider.name
}

export function modelChoices(
  t: Translate,
  menu: ModelMenu,
  disabled: (option: ModelOption) => boolean = () => false,
): readonly Choice<string>[] {
  return menu.options.map((option) => ({
    value: option.key,
    label: optionLabel(t, menu, option),
    ...(option.kind === "fixed" ? { group: option.provider.name, title: option.model.id } : {}),
    ...(disabled(option) ? { disabled: true } : {}),
  }))
}

function effortLabel(t: Translate, option: ModelOption, effort: EffortOption): string {
  if (effort.value !== DEFAULT_EFFORT) return effort.name ?? effort.value
  const named = defaultEffortName(option)
  return named === undefined
    ? t("models.effort.default")
    : t("models.effort.defaultNamed", { effort: named })
}

export function effortChoices(
  t: Translate,
  option: ModelOption,
  current: string | undefined,
  disabled: (effort: string) => boolean = () => false,
): readonly Choice<string>[] {
  return effortOptions(option, current).map((effort) => ({
    value: effort.value,
    label: effortLabel(t, option, effort),
    ...(disabled(effort.value) ? { disabled: true } : {}),
  }))
}

const REFUSED: { readonly [Code in BotModelsErrorCode]: MessageKey } = {
  "bot-models/not-found": "models.refused.not-found",
  "bot-models/unknown-provider": "models.refused.unknown-provider",
  "bot-models/unknown-model": "models.refused.unknown-model",
  "bot-models/invalid-effort": "models.refused.invalid-effort",
  "bot-models/catalog-failed": "models.refused.catalog-failed",
  "bot-models/rejected": "models.refused.rejected",
}

export function modelsFailureText(t: Translate, failure: ModelsFailure): string {
  return failure.kind === "refused"
    ? t(REFUSED[failure.code])
    : t("error.generic", { message: failure.message })
}
