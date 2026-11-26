import { useRef, useState } from "react"
import { useLayer } from "./layers"
import type { DataMarks } from "./marks"
import type { TextDraft } from "./text-draft"

export interface TextAreaProps {
  readonly draft: TextDraft
  readonly label: string
  readonly placeholder?: string
  readonly rows?: number
  readonly flag?: "danger" | "warning"
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

export function TextArea(props: TextAreaProps) {
  const { draft, label, disabled, marks } = props
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayer(ref, { active: focused && draft.editing, trap: false, onEscape: draft.reset })
  const invalid = draft.error !== null || props.flag === "danger"
  return (
    <textarea
      ref={ref}
      className="dshb-ui-textarea"
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      aria-busy={draft.busy ? true : undefined}
      data-invalid={invalid ? "" : undefined}
      data-flag={!invalid && props.flag === "warning" ? "warning" : undefined}
      rows={props.rows ?? 3}
      spellCheck={false}
      value={draft.text}
      placeholder={props.placeholder}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        draft.commit()
      }}
      onChange={(event) => draft.change(event.currentTarget.value)}
      {...marks}
    />
  )
}
