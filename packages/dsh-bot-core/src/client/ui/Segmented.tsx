import { useId } from "react"
import type { Choice } from "./choices"
import type { DataMarks } from "./marks"

export interface SegmentedProps<Value extends string> {
  readonly value: Value
  readonly choices: readonly Choice<Value>[]
  onChange(value: Value): void
  /** The group's accessible name. */
  readonly label: string
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

/** A short exclusive choice (Allow / Ask / Disallow): the selected segment is filled; arrow keys move and pick. */
export function Segmented<Value extends string>(props: SegmentedProps<Value>) {
  const { value, choices, onChange, label, disabled, marks } = props
  const name = useId()
  return (
    <fieldset className="dshb-ui-segmented" aria-label={label} disabled={disabled} {...marks}>
      {choices.map((choice) => {
        const checked = choice.value === value
        return (
          <label
            key={choice.value}
            className="dshb-ui-segment"
            title={choice.title}
            data-checked={checked ? "" : undefined}
            data-disabled={choice.disabled === true ? "" : undefined}
          >
            <input
              type="radio"
              className="dshb-ui-segment-input"
              name={name}
              value={choice.value}
              checked={checked}
              disabled={choice.disabled}
              onChange={() => onChange(choice.value)}
            />
            {choice.label}
          </label>
        )
      })}
    </fieldset>
  )
}
