import { type ReactNode, useRef, useState } from "react"
import { counterShown } from "./counter"
import { useLayer } from "./layers"
import type { DataMarks } from "./marks"
import { Row } from "./Row"
import { type TextDraft, type TextDraftOptions, useTextDraft } from "./text-draft"

export interface TextFieldProps {
  readonly draft: TextDraft
  readonly label: string
  readonly placeholder?: string
  readonly maxLength?: number
  readonly type?: "text" | "url" | "email"
  readonly width?: "regular" | "fill"
  readonly disabled?: boolean
  readonly autoFocus?: boolean
  readonly marks?: DataMarks
}

export function TextField(props: TextFieldProps) {
  const { draft, label, maxLength, disabled, marks } = props
  const [focused, setFocused] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  useLayer(wrapRef, { active: focused && draft.editing, trap: false, onEscape: draft.reset })
  const counted = counterShown(focused, draft.text.length, maxLength)
  return (
    <span
      ref={wrapRef}
      className="dshb-ui-field"
      data-width={props.width ?? "regular"}
      data-invalid={draft.error === null ? undefined : ""}
      data-disabled={disabled === true ? "" : undefined}
    >
      <input
        className="dshb-ui-field-input"
        type={props.type ?? "text"}
        aria-label={label}
        aria-invalid={draft.error === null ? undefined : true}
        aria-busy={draft.busy ? true : undefined}
        value={draft.text}
        placeholder={props.placeholder}
        maxLength={maxLength}
        disabled={disabled}
        data-dshb-autofocus={props.autoFocus === true ? "" : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          draft.commit()
        }}
        onChange={(event) => draft.change(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return
          event.preventDefault()
          draft.commit()
        }}
        {...marks}
      />
      {maxLength !== undefined && counted && (
        <span
          className="dshb-ui-field-counter"
          data-full={draft.text.length >= maxLength ? "" : undefined}
        >
          {draft.text.length}/{maxLength}
        </span>
      )}
    </span>
  )
}

export interface TextFieldRowProps extends TextDraftOptions {
  readonly label: string
  readonly meta?: ReactNode
  readonly placeholder?: string
  readonly maxLength?: number
  readonly type?: "text" | "url" | "email"
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

export function TextFieldRow(props: TextFieldRowProps) {
  const draft = useTextDraft(props)
  return (
    <Row
      label={props.label}
      meta={draft.error ?? props.meta}
      metaTone={draft.error === null ? undefined : "danger"}
      trailing={
        <TextField
          draft={draft}
          label={props.label}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          type={props.type}
          disabled={props.disabled}
          marks={props.marks}
        />
      }
    />
  )
}
