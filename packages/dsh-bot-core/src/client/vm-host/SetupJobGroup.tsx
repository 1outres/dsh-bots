import type { ReactNode } from "react"
import type { SetupFailure, SetupJobView, SetupStepView } from "../../shared/vm-host-setup"
import { useNow } from "../hooks"
import { elapsedText } from "../lifecycle"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { BlockRow, Button, Group, NavRow, Row, StatusPill, Tag } from "../ui"
import { Command } from "./Command"
import { jobEnded, jobRetryable, stepElapsed, stepTone } from "./setup-model"

export interface SetupJobActions {
  cancel(): void
  retry(): void
  dismiss(): void
  openLog(): void
  investigate(): void
}

export function SetupJobGroup(props: {
  readonly t: Translate
  readonly job: SetupJobView
  readonly busy: boolean
  readonly actions: SetupJobActions
}) {
  const { t, job, actions } = props
  const running = !jobEnded(job)
  const now = useNow(running)
  const format = localeFormat(t)
  const failureShown = job.failure !== undefined && jobRetryable(job)
  const retryButton = (
    <Button
      variant="row"
      disabled={props.busy}
      onClick={actions.retry}
      marks={{ "data-dshb-setup-retry": "" }}
    >
      {t("setup.retry")}
    </Button>
  )
  return (
    <Group
      title={t(`setup.title.${job.state}`)}
      tag={<Tag>{siteText(t, job)}</Tag>}
      aside={
        running ? (
          <Button
            variant="row"
            disabled={props.busy || job.state === "cancelling"}
            onClick={actions.cancel}
            marks={{ "data-dshb-setup-cancel": "" }}
          >
            {job.state === "cancelling" ? t("setup.cancelling") : t("setup.cancel")}
          </Button>
        ) : (
          <span className="dshb-vm-host-buttons">
            {jobRetryable(job) && !failureShown && retryButton}
            <Button
              variant="row"
              disabled={props.busy}
              onClick={actions.dismiss}
              marks={{ "data-dshb-setup-dismiss": "" }}
            >
              {t("setup.dismiss")}
            </Button>
          </span>
        )
      }
      marks={{ "data-dshb-setup-job": job.state }}
    >
      {job.steps.map((step) => (
        <StepRow key={step.id} t={t} step={step} now={now} />
      ))}
      <NavRow
        label={t("setup.log")}
        meta={format.count("setup.log.lines", job.log.lines)}
        onOpen={actions.openLog}
        marks={{ "data-dshb-setup-log": "" }}
      />
      {failureShown && job.failure !== undefined && (
        <FailureRow t={t} failure={job.failure}>
          {retryButton}
          {(job.state === "failed" || job.state === "interrupted") && (
            <Button
              variant="row"
              disabled={props.busy}
              onClick={actions.investigate}
              marks={{ "data-dshb-setup-investigate": "" }}
            >
              {t("setup.investigate")}
            </Button>
          )}
        </FailureRow>
      )}
    </Group>
  )
}

function siteText(t: Translate, job: SetupJobView): string {
  const site = job.site
  const where =
    site.kind === "this-machine" ? t("setup.site.this-machine") : `${site.user}@${site.host}`
  return `${where} · ${job.project}`
}

function StepRow(props: {
  readonly t: Translate
  readonly step: SetupStepView
  readonly now: number
}) {
  const { t, step } = props
  const elapsed = stepElapsed(step, props.now)
  const meta = [step.note, elapsed === null ? undefined : elapsedText(elapsed)]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ")
  return (
    <Row
      label={t(`setup.step.${step.id}`)}
      meta={meta === "" ? undefined : meta}
      metaTone={step.state === "failed" ? "danger" : undefined}
      trailing={
        <StatusPill tone={stepTone(step.state)} label={t(`setup.stepState.${step.state}`)} />
      }
      marks={{ "data-dshb-setup-step": step.id, "data-dshb-setup-step-state": step.state }}
    />
  )
}

function FailureRow(props: {
  readonly t: Translate
  readonly failure: SetupFailure
  readonly children: ReactNode
}) {
  const { t, failure } = props
  const facts = [
    t("setup.failure.step", { step: t(`setup.step.${failure.step}`) }),
    failure.command === undefined
      ? undefined
      : failure.exitCode === undefined
        ? failure.command
        : t("setup.failure.exit", { command: failure.command, code: failure.exitCode }),
    failure.location === undefined
      ? undefined
      : t("setup.failure.location", { location: failure.location }),
  ].filter((part) => part !== undefined)
  return (
    <BlockRow
      label={t(`setupFailure.${failure.code}`)}
      meta={failure.what}
      metaTone="danger"
      marks={{ "data-dshb-setup-failure": failure.code }}
    >
      <Command t={t} text={failure.fix} />
      <span className="dshb-vm-host-facts">{facts.join(" · ")}</span>
      {failure.logTail.length > 0 && (
        <pre className="dshb-vm-host-log" data-dshb-setup-failure-log="">
          {failure.logTail.join("\n")}
        </pre>
      )}
      <span className="dshb-vm-host-buttons">{props.children}</span>
    </BlockRow>
  )
}
