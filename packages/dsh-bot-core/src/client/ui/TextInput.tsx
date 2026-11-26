import { useState } from "react"
import { counterShown } from "./counter"
import type { DataMarks } from "./marks"

export interface TextInputProps {
  readonly value: string
  onChange(value: string): void
  readonly label: string
  readonly placeholder?: string
  readonly maxLength?: number
  readonly disabled?: boolean
  readonly autoFocus?: boolean
  readonly width?: "fill" | "compact"
  readonly marks?: DataMarks
}

export function TextInput(props: TextInputProps) {
  const { value, maxLength, disabled } = props
  const [focused, setFocused] = useState(false)
  return (
    <span
      className="dshb-ui-field"
      data-width={props.width ?? "fill"}
      data-disabled={disabled === true ? "" : undefined}
    >
      <input
        className="dshb-ui-field-input"
        type="text"
        aria-label={props.label}
        value={value}
        placeholder={props.placeholder}
        maxLength={maxLength}
        disabled={disabled}
        data-dshb-autofocus={props.autoFocus === true ? "" : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        {...props.marks}
      />
      {maxLength !== undefined && counterShown(focused, value.length, maxLength) && (
        <span
          className="dshb-ui-field-counter"
          data-full={value.length >= maxLength ? "" : undefined}
        >
          {value.length}/{maxLength}
        </span>
      )}
    </span>
  )
}
