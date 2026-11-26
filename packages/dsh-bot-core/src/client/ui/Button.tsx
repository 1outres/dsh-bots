import type { ReactNode } from "react"
import type { DataMarks } from "./marks"

interface ButtonCommon {
  onClick?(): void
  readonly type?: "button" | "submit"
  readonly form?: string
  readonly disabled?: boolean
  readonly tone?: "danger"
  readonly autoFocus?: boolean
  readonly expanded?: boolean
  readonly controls?: string
  readonly pressed?: boolean
  readonly marks?: DataMarks
}

export type ButtonProps = ButtonCommon &
  (
    | {
        readonly variant: "primary" | "secondary" | "row"
        readonly children: ReactNode
      }
    | {
        readonly variant: "icon"
        readonly label: string
        readonly children: ReactNode
      }
  )

export function Button(props: ButtonProps) {
  const named = props.variant === "icon" ? { "aria-label": props.label, title: props.label } : {}
  return (
    <button
      type={props.type ?? "button"}
      form={props.form}
      className="dshb-ui-button"
      data-variant={props.variant}
      data-tone={props.tone}
      disabled={props.disabled}
      data-dshb-autofocus={props.autoFocus === true ? "" : undefined}
      aria-expanded={props.expanded}
      aria-controls={props.controls}
      aria-pressed={props.pressed}
      onClick={props.onClick}
      {...named}
      {...props.marks}
    >
      {props.children}
    </button>
  )
}
