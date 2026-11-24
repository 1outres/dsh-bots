import type { ReactNode } from "react"
import type { DataMarks } from "./marks"

interface ButtonCommon {
  onClick?(): void
  readonly type?: "button" | "submit"
  /** The id of the form a `submit` button outside it sends. */
  readonly form?: string
  readonly disabled?: boolean
  /** Red: the confirming button of a destructive dialog (filled) or a destructive row action (text). */
  readonly tone?: "danger"
  /** The control focus lands on when its dialog opens. */
  readonly autoFocus?: boolean
  /** Whether what the button shows and hides (`controls`) is shown. */
  readonly expanded?: boolean
  /** The id of the element the button shows and hides. */
  readonly controls?: string
  /** Whether a toggle button is on. */
  readonly pressed?: boolean
  readonly marks?: DataMarks
}

export type ButtonProps = ButtonCommon &
  (
    | {
        /** `primary` / `secondary`: 36px, dialog footers; `row`: 28px, inside rows. */
        readonly variant: "primary" | "secondary" | "row"
        readonly children: ReactNode
      }
    | {
        /** A 28px ghost button holding only an icon, named by `label`. */
        readonly variant: "icon"
        readonly label: string
        readonly children: ReactNode
      }
  )

/** bot-core's one button. */
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
