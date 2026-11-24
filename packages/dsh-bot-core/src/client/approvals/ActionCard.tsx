import { useState } from "react"
import type {
  ConnectorActionView,
  ConnectorDecision,
  ConnectorDecisionResult,
} from "../../shared/connectors"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { Button, StatusPill } from "../ui"
import type { DecisionOutcome } from "./actions-model"
import { actionTone, deciderOf, decisionOf, foldBody, resultText } from "./view"

function refusalKey(result: Extract<ConnectorDecisionResult, { accepted: false }>): string {
  return `approvals.refused.${result.reason}`
}

/** Text that may run long, folded with "Show all" (shown as typed: never as HTML or Markdown). */
function LongText(props: {
  readonly t: Translate
  readonly text: string
  readonly mono?: boolean
}) {
  const { t, text } = props
  const [whole, setWhole] = useState(false)
  const folded = foldBody(text)
  return (
    <div className="dshb-action-long">
      <pre className="dshb-action-text" data-mono={props.mono === true ? "" : undefined}>
        {folded === undefined || whole ? text : `${folded}…`}
      </pre>
      {folded !== undefined && (
        <Button variant="row" onClick={() => setWhole(!whole)}>
          {t(whole ? "approvals.body.fold" : "approvals.body.all")}
        </Button>
      )}
    </div>
  )
}

/** The connector, the tool and when it was asked for, on one tertiary line. */
export function actionMeta(t: Translate, action: ConnectorActionView, at: number, now: number) {
  return [
    action.connector.name ?? action.connector.id,
    action.toolName,
    localeFormat(t).relative(at, now, "largestUnit"),
  ].join(" · ")
}

function Preview({ t, action }: { readonly t: Translate; readonly action: ConnectorActionView }) {
  const { preview } = action
  return (
    <>
      {preview.fields.length > 0 && (
        <dl className="dshb-action-fields">
          {preview.fields.map((field, index) => (
            <div key={index} className="dshb-action-field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {preview.body !== undefined && preview.body !== "" && <LongText t={t} text={preview.body} />}
    </>
  )
}

export interface ActionCardProps {
  readonly t: Translate
  /** An open action: pending, approved or running. */
  readonly action: ConnectorActionView
  readonly now: number
  decide(actionId: string, decision: ConnectorDecision): Promise<DecisionOutcome>
}

/** An open action: its state and expiry, the preview, where it comes from, and Reject / Approve while it is pending. */
export function ActionCard(props: ActionCardProps) {
  const { t, action, now } = props
  const { status } = action
  const format = localeFormat(t)
  const [busy, setBusy] = useState<ConnectorDecision | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const pending = status.state === "pending"

  const decide = async (decision: ConnectorDecision) => {
    setBusy(decision)
    setError(undefined)
    const outcome = await props.decide(action.id, decision)
    setBusy(undefined)
    if (outcome.kind === "unreachable") {
      setError(t("approvals.refused.unreachable", { message: outcome.message }))
    } else if (!outcome.result.accepted && outcome.result.reason !== "settled") {
      setError(t(refusalKey(outcome.result)))
    }
  }

  return (
    <article
      className="dshb-action"
      data-state={status.state}
      data-dshb-action={action.id}
      aria-label={action.preview.title}
    >
      <div className="dshb-action-status">
        <StatusPill tone={actionTone(status)} label={t(`approvals.state.${status.state}`)} />
        {pending && action.expiresAt > now && (
          <span
            className="dshb-action-expiry"
            title={format.instant(action.expiresAt, "dateTime")}
            data-dshb-action-expiry=""
          >
            {format.relative(action.expiresAt, now, "largestUnit")}
          </span>
        )}
      </div>
      <h3 className="dshb-action-title">{action.preview.title}</h3>
      <Preview t={t} action={action} />
      <p className="dshb-action-meta" title={format.instant(action.createdAt, "dateTime")}>
        {actionMeta(t, action, action.createdAt, now)}
      </p>
      {error !== undefined && (
        <p className="dshb-action-error" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <div className="dshb-action-buttons">
          <Button
            variant="secondary"
            disabled={busy !== undefined}
            marks={{ "data-dshb-action-decide": "reject" }}
            onClick={() => void decide("reject")}
          >
            {t(busy === "reject" ? "approvals.rejecting" : "approvals.reject")}
          </Button>
          <Button
            variant="primary"
            disabled={busy !== undefined}
            marks={{ "data-dshb-action-decide": "approve" }}
            onClick={() => void decide("approve")}
          >
            {t(busy === "approve" ? "approvals.approving" : "approvals.approve")}
          </Button>
        </div>
      )}
    </article>
  )
}

function Outcome({ t, action }: { readonly t: Translate; readonly action: ConnectorActionView }) {
  const { status } = action
  switch (status.state) {
    case "failed":
      return (
        <p className="dshb-action-outcome" data-tone="danger">
          {t("approvals.outcome.failed", { reason: status.reason })}
        </p>
      )
    case "interrupted":
      return (
        <p className="dshb-action-outcome" data-tone="danger">
          {t("approvals.outcome.interrupted")}
        </p>
      )
    case "succeeded": {
      const result = resultText(status.text, status.result)
      return result === undefined ? null : (
        <section className="dshb-action-section">
          <h4 className="dshb-action-caption">{t("approvals.result")}</h4>
          <LongText t={t} text={result} mono />
        </section>
      )
    }
    default:
      return null
  }
}

/** An ended action's details, disclosed under its history row: how it ended, who decided in a channel, its preview and arguments. */
export function ActionDetails({
  t,
  action,
}: {
  readonly t: Translate
  readonly action: ConnectorActionView
}) {
  const decision = decisionOf(action.status)
  const decider = decision === undefined ? undefined : deciderOf(decision)
  return (
    <div className="dshb-action-details" data-dshb-action-details={action.id}>
      <Outcome t={t} action={action} />
      {decider !== undefined && decision !== undefined && (
        <p className="dshb-action-outcome" data-dshb-action-decider={decision.origin.kind}>
          {t(decider.key, decider.params)}
        </p>
      )}
      <Preview t={t} action={action} />
      <section className="dshb-action-section">
        <h4 className="dshb-action-caption">{t("approvals.args")}</h4>
        <pre className="dshb-action-text" data-mono="">
          {JSON.stringify(action.args, null, 2)}
        </pre>
      </section>
    </div>
  )
}
