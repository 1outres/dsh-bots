import type { CreationPhase } from "../../shared/bots"
import { Avatar } from "../Avatar"
import { useNow, useObservable } from "../hooks"
import type { MessageKey } from "../i18n"
import { IconAlert, IconCheck, Spinner } from "../icons"
import { creationSteps, elapsedText, pendingOf, type StepState } from "../lifecycle"
import { snapshotOf } from "../session-classification"
import type { Translate } from "../types"
import { Button } from "../ui"
import type { ShellFace } from "./face"

const STEP_LABELS: { readonly [Phase in CreationPhase]: MessageKey } = {
  queued: "step.queued",
  creating: "step.creating",
  booting: "step.booting",
  connecting: "step.connecting",
  preset: "step.preset",
  "starting-main": "step.starting-main",
}

const STEP_STATES: { readonly [State in StepState]: MessageKey } = {
  done: "progress.step.done",
  current: "progress.step.current",
  failed: "progress.step.failed",
  waiting: "progress.step.waiting",
}

function StepMark({ state }: { readonly state: StepState }) {
  switch (state) {
    case "done":
      return <IconCheck size={14} />
    case "current":
      return <Spinner size={14} />
    case "failed":
      return <IconAlert size={14} />
    case "waiting":
      return <span className="dshb-step-dot" />
  }
}

interface ProgressProps extends Pick<ShellFace, "bots" | "pending"> {
  readonly t: Translate
  readonly botId: string
}

/** A bot's creation in the main view: its steps, the time it has taken, and its failure. */
export function CreationProgress({ t, bots, pending: actions, botId }: ProgressProps) {
  const snapshot = snapshotOf(useObservable(bots))
  const pending = snapshot === undefined ? undefined : pendingOf(snapshot, botId)
  const failure = pending?.failure
  const now = useNow(pending !== undefined && failure === undefined)
  if (pending === undefined || pending.operation.kind !== "create") {
    return (
      <div className="dshb-shell" data-dshb-progress="">
        <div className="dshb-shell-placeholder">
          <p role="status">{t("shell.classifying")}</p>
        </div>
      </div>
    )
  }
  const failed = failure !== undefined
  const steps = creationSteps(pending.operation.phase, failed)
  const elapsed = elapsedText((failure?.at ?? now) - pending.startedAt)
  return (
    <div
      className="dshb-shell dshb-progress"
      data-dshb-progress=""
      data-bot-id={pending.id}
      data-failed={failed ? "" : undefined}
    >
      <section className="dshb-progress-card" aria-labelledby="dshb-progress-title">
        <span className="dshb-progress-face">
          <Avatar avatar={pending.avatar} size={56} />
        </span>
        <h1 className="dshb-progress-title" id="dshb-progress-title">
          {t(failed ? "progress.failedTitle" : "progress.title", { name: pending.name })}
        </h1>
        <p className="dshb-progress-elapsed" data-dshb-elapsed="">
          {t("progress.elapsed", { time: elapsed })}
        </p>
        <ol className="dshb-steps">
          {steps.map((step) => (
            <li
              key={step.phase}
              className="dshb-step"
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <span className="dshb-step-mark">
                <StepMark state={step.state} />
              </span>
              <span className="dshb-step-label">{t(STEP_LABELS[step.phase])}</span>
              <span className="dshb-visually-hidden">{t(STEP_STATES[step.state])}</span>
            </li>
          ))}
        </ol>
        {failure !== undefined && (
          <div className="dshb-progress-failure" role="alert">
            <p className="dshb-progress-message">{failure.message}</p>
            <div className="dshb-progress-actions">
              <Button variant="secondary" onClick={() => actions.discardCreate(pending.id)}>
                {t("pending.discard")}
              </Button>
              <Button variant="primary" onClick={() => actions.retryCreate(pending.id)}>
                {t("pending.retry")}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
