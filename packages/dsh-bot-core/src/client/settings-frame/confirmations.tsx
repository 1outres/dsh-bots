import { type ReactNode, useId, useRef } from "react"
import type { Translate } from "../types"
import { Button } from "../ui/Button"
import { useLayer } from "../ui/layers"
import type { DataMarks } from "../ui/marks"
import type { FrameConfirmation, FrameLeave } from "./flow"

interface ConfirmDialogProps {
  readonly title: string
  readonly description: string
  readonly cancel: string
  readonly confirm: string
  readonly tone: "primary" | "danger"
  onAnswer(confirmed: boolean): void
  readonly marks: DataMarks
  readonly acceptMarks: DataMarks
}

function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const id = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useLayer(dialogRef, { active: true, trap: true, onEscape: () => props.onAnswer(false) })
  return (
    <div className="dshb-modal-root">
      <div className="dshb-modal-mask" aria-hidden="true" onClick={() => props.onAnswer(false)} />
      <div
        ref={dialogRef}
        className="dshb-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        {...props.marks}
      >
        <div className="dshb-modal-header">
          <h2 id={`${id}-title`} className="dshb-modal-title">
            {props.title}
          </h2>
        </div>
        <div className="dshb-modal-body">
          <p className="dshb-confirm-text" id={`${id}-description`}>
            {props.description}
          </p>
        </div>
        <div className="dshb-modal-footer">
          <Button
            variant="secondary"
            autoFocus
            onClick={() => props.onAnswer(false)}
            marks={{ "data-dshb-settings-keep": "" }}
          >
            {props.cancel}
          </Button>
          <Button
            variant="primary"
            tone={props.tone === "danger" ? "danger" : undefined}
            onClick={() => props.onAnswer(true)}
            marks={props.acceptMarks}
          >
            {props.confirm}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DiscardConfirm(props: {
  readonly t: Translate
  readonly leaving: FrameLeave
  readonly section: string
  onKeep(): void
  onDiscard(): void
}) {
  const { t } = props
  return (
    <ConfirmDialog
      title={t("settings.discard.title")}
      description={t("settings.discard.description", { section: props.section })}
      cancel={t("settings.discard.keep")}
      confirm={
        props.leaving === "close" ? t("settings.discard.close") : t("settings.discard.confirm")
      }
      tone="danger"
      onAnswer={(confirmed) => (confirmed ? props.onDiscard() : props.onKeep())}
      marks={{ "data-dshb-settings-discard": props.leaving }}
      acceptMarks={{ "data-dshb-settings-discard-accept": "" }}
    />
  )
}

export function StepConfirm(props: {
  readonly t: Translate
  readonly request: FrameConfirmation
  onAnswer(confirmed: boolean): void
}) {
  const { t, request } = props
  return (
    <ConfirmDialog
      title={request.title}
      description={request.description}
      cancel={t("settings.confirm.cancel")}
      confirm={request.confirm}
      tone={request.tone}
      onAnswer={props.onAnswer}
      marks={{ "data-dshb-settings-confirm": request.tone }}
      acceptMarks={{ "data-dshb-settings-confirm-accept": "" }}
    />
  )
}
