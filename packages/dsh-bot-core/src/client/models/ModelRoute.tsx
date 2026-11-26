import type { BotModelChoice } from "../../shared/models"
import type { Translate } from "../types"
import { type DataMarks, SearchSelect, Select } from "../ui"
import { effortChoices, modelChoices } from "./labels"
import { choiceOf, effortOf, type ModelMenu, type ModelOption } from "./menu"

export interface ModelRouteProps {
  readonly t: Translate
  readonly menu: ModelMenu
  readonly value: BotModelChoice
  readonly label: string
  readonly disabled?: boolean
  onChange(choice: BotModelChoice): void
  readonly effortTaken?: (effort: string) => boolean
  readonly marks?: DataMarks
}

export function ModelRoute({
  t,
  menu,
  value,
  label,
  disabled,
  onChange,
  effortTaken,
  marks,
}: ModelRouteProps) {
  const option = menu.optionOf(value)
  const efforts = effortChoices(
    t,
    option,
    value.kind === "fixed" ? value.reasoningEffort : undefined,
    effortTaken,
  )
  const pick = (picked: ModelOption | undefined) => {
    if (picked !== undefined) onChange(choiceOf(picked))
  }
  return (
    <span className="dshb-models-route" {...marks}>
      <SearchSelect
        t={t}
        value={option.key}
        choices={modelChoices(t, menu)}
        onChange={(key) => pick(menu.find(key))}
        label={label}
        disabled={disabled}
        marks={{ "data-dshb-model-picker": "" }}
      />
      {efforts.length > 0 && (
        <Select
          value={effortOf(value)}
          choices={efforts}
          onChange={(effort) => onChange(choiceOf(option, effort))}
          label={t("models.effortOf", { model: label })}
          disabled={disabled}
          marks={{ "data-dshb-model-effort": "" }}
        />
      )}
    </span>
  )
}
