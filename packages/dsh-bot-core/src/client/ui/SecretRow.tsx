import { type ReactNode, useRef } from "react"
import { IconCheck, IconClose } from "../icons"
import type { Translate } from "../types"
import { Button } from "./Button"
import type { CommitResult } from "./commit"
import { useLayer } from "./layers"
import type { DataMarks } from "./marks"
import { Row } from "./Row"
import { StatusPill } from "./StatusPill"
import { useSecretEditor } from "./secret-editor"

export interface SecretRowProps {
  readonly t: Translate
  readonly label: string
  /** Whether a secret is saved; the secret itself never reaches the browser. */
  readonly saved: boolean
  /** Save a typed secret; the editor stays open with the message when it fails. */
  commit(secret: string): Promise<CommitResult>
  /** Remove the saved secret; without it the row offers no Remove. */
  remove?(): Promise<CommitResult>
  validate?(secret: string): string | null
  /** Shown instead of the pill while present (a test result). */
  readonly status?: ReactNode
  /** Row buttons before Set / Replace (Test). */
  readonly actions?: ReactNode
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

/**
 * A secret setting: a Set / Not set pill and Set, Replace and Remove; Set and
 * Replace open a password field with ✓ and × in place of the controls.
 */
export function SecretRow(props: SecretRowProps) {
  const { t, label, saved } = props
  const editor = useSecretEditor(props)
  const editorRef = useRef<HTMLSpanElement>(null)
  useLayer(editorRef, { active: editor.open, trap: false, onEscape: editor.cancel })

  const trailing = editor.open ? (
    <span className="dshb-ui-secret-editor" ref={editorRef}>
      <span className="dshb-ui-field" data-invalid={editor.error === null ? undefined : ""}>
        <input
          className="dshb-ui-field-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          aria-invalid={editor.error === null ? undefined : true}
          // biome-ignore lint/a11y/noAutofocus: the editor opens for typing the secret
          autoFocus
          placeholder={props.placeholder}
          value={editor.text}
          disabled={editor.busy}
          onChange={(event) => editor.change(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            editor.submit()
          }}
        />
      </span>
      <Button
        variant="icon"
        label={t("ui.secret.save")}
        disabled={editor.busy || editor.text === ""}
        onClick={editor.submit}
        marks={{ "data-dshb-secret-save": "" }}
      >
        <IconCheck size={14} />
      </Button>
      <Button
        variant="icon"
        label={t("ui.secret.cancel")}
        disabled={editor.busy}
        onClick={editor.cancel}
      >
        <IconClose size={14} />
      </Button>
    </span>
  ) : (
    <>
      {props.status ?? (
        <StatusPill
          tone={saved ? "success" : "idle"}
          label={saved ? t("ui.secret.state.set") : t("ui.secret.state.unset")}
        />
      )}
      {props.actions}
      <Button
        variant="row"
        disabled={props.disabled === true || editor.busy}
        onClick={editor.start}
        marks={{ "data-dshb-secret-edit": "" }}
      >
        {saved ? t("ui.secret.replace") : t("ui.secret.set")}
      </Button>
      {saved && props.remove !== undefined && (
        <Button
          variant="row"
          tone="danger"
          disabled={props.disabled === true || editor.busy}
          onClick={editor.remove}
          marks={{ "data-dshb-secret-remove": "" }}
        >
          {t("ui.secret.remove")}
        </Button>
      )}
    </>
  )
  return (
    <Row
      label={label}
      meta={editor.error ?? undefined}
      metaTone={editor.error === null ? undefined : "danger"}
      trailing={trailing}
      marks={{ "data-dshb-secret": saved ? "set" : "unset", ...props.marks }}
    />
  )
}
