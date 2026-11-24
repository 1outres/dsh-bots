import type { DataMarks } from "./marks"

export interface SwitchProps {
  readonly checked: boolean
  onChange(checked: boolean): void
  /** The switch's accessible name (the row's label). */
  readonly label: string
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

/** An on/off setting that takes effect at once. */
export function Switch({ checked, onChange, label, disabled, marks }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="dshb-ui-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...marks}
    >
      <span className="dshb-ui-switch-thumb" />
    </button>
  )
}
