import { IconChevronDown } from "../icons"
import { type Choice, groupChoices } from "./choices"
import type { DataMarks } from "./marks"

export interface SelectProps<Value extends string> {
  readonly value: Value
  readonly choices: readonly Choice<Value>[]
  /** Called when another choice is picked; the setting is saved then. */
  onChange(value: Value): void
  /** The select's accessible name (the row's label). */
  readonly label: string
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

function SelectOption<Value extends string>({ choice }: { readonly choice: Choice<Value> }) {
  return (
    <option value={choice.value} disabled={choice.disabled} title={choice.title}>
      {choice.label}
    </option>
  )
}

/** A native select in DSH's field look; grouped choices are listed under their group. */
export function Select<Value extends string>(props: SelectProps<Value>) {
  const { value, choices, onChange, label, disabled, marks } = props
  return (
    <span className="dshb-ui-select" data-disabled={disabled === true ? "" : undefined}>
      <select
        className="dshb-ui-select-input"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const picked = choices.find((choice) => choice.value === event.currentTarget.value)
          if (picked !== undefined) onChange(picked.value)
        }}
        {...marks}
      >
        {groupChoices(choices).map((run) =>
          run.group === undefined ? (
            run.choices.map((choice) => <SelectOption key={choice.value} choice={choice} />)
          ) : (
            <optgroup key={`group:${run.group}:${run.choices[0]?.value}`} label={run.group}>
              {run.choices.map((choice) => (
                <SelectOption key={choice.value} choice={choice} />
              ))}
            </optgroup>
          ),
        )}
      </select>
      <span className="dshb-ui-select-chevron" aria-hidden="true">
        <IconChevronDown size={14} />
      </span>
    </span>
  )
}
