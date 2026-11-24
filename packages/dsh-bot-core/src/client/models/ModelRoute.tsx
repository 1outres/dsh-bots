import type { BotModelChoice } from "../../shared/models"
import type { Translate } from "../types"
import { type DataMarks, SearchSelect, Select } from "../ui"
import { effortChoices, modelChoices } from "./labels"
import { choiceOf, effortOf, type ModelMenu, type ModelOption } from "./menu"

export interface ModelRouteProps {
  readonly t: Translate
  readonly menu: ModelMenu
  readonly value: BotModelChoice
  /** The row's label: the model picker's name, and the effort picker's after it. */
  readonly label: string
  readonly disabled?: boolean
  /** Called with the picked choice; a new model starts at its provider's effort. */
  onChange(choice: BotModelChoice): void
  /** Efforts of the current model that cannot be picked (another item holds them). */
  readonly effortTaken?: (effort: string) => boolean
  readonly marks?: DataMarks
}

/** A model picker (DSH's default and the catalog's models by provider) and, when the model has efforts, its effort. */
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
