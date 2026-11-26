import { useState } from "react"
import { isFreemailDomain, type SenderChoice, type SenderInquiryView } from "../../shared/senders"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { Button, StatusPill } from "../ui"
import type { AnswerOutcome } from "./inquiries"
import { choiceText, inquiryOutcome, inquiryTone } from "./texts"

export interface InquiryCardProps {
  readonly t: Translate
  readonly inquiry: SenderInquiryView
  readonly now: number
  answer(inquiryId: string, choice: SenderChoice): Promise<AnswerOutcome>
}

export function InquiryCard({ t, inquiry, now, answer }: InquiryCardProps) {
  const format = localeFormat(t)
  const [busy, setBusy] = useState<SenderChoice | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const pending = inquiry.status.state === "pending"
  const outcome = inquiryOutcome(t, inquiry)
  const pick = async (choice: SenderChoice) => {
    setBusy(choice)
    setError(undefined)
    const result = await answer(inquiry.id, choice)
    setBusy(undefined)
    if (result.kind === "unreachable") {
      setError(t("senders.refused.unreachable", { message: result.message }))
    } else if (!result.result.accepted && result.result.reason !== "settled") {
      setError(t(`senders.refused.${result.result.reason}`))
    }
  }
  return (
    <article
      className="dshb-action"
      data-state={inquiry.status.state}
      data-dshb-sender-inquiry={inquiry.id}
      aria-label={t("senders.inquiry.title", { address: inquiry.address })}
    >
      <div className="dshb-action-status">
        <StatusPill
          tone={inquiryTone(inquiry)}
          label={t(`senders.state.${inquiry.status.state}`)}
        />
        {pending && inquiry.expiresAt > now && (
          <span
            className="dshb-action-expiry"
            title={t("senders.inquiry.expiry.note")}
            data-dshb-sender-inquiry-expiry=""
          >
            {t("senders.inquiry.expires", {
              at: format.relative(inquiry.expiresAt, now, "largestUnit"),
            })}
          </span>
        )}
      </div>
      <h3 className="dshb-action-title">
        {t("senders.inquiry.title", { address: inquiry.address })}
      </h3>
      {pending && (
        <p className="dshb-action-meta" data-dshb-sender-inquiry-waiting="">
          {format.count("senders.inquiry.waiting", inquiry.waiting)}
        </p>
      )}
      {inquiry.samples.length > 0 && (
        <section className="dshb-action-section">
          <h4 className="dshb-action-caption">{t("senders.inquiry.samples")}</h4>
          {inquiry.samples.map((sample, index) => (
            <pre key={index} className="dshb-action-text">
              {sample}
            </pre>
          ))}
        </section>
      )}
      <p className="dshb-action-meta" title={format.instant(inquiry.createdAt, "dateTime")}>
        {t("senders.inquiry.meta", {
          connector: inquiry.connector.name ?? inquiry.connector.id,
          account: inquiry.account,
          at: format.relative(inquiry.createdAt, now, "largestUnit"),
        })}
      </p>
      {outcome !== undefined && (
        <p className="dshb-action-outcome" data-dshb-sender-inquiry-outcome="">
          {outcome}
        </p>
      )}
      {pending && isFreemailDomain(inquiry.domain) && (
        <p className="dshb-action-meta">
          {t("senders.inquiry.freemail", { domain: inquiry.domain })}
        </p>
      )}
      {error !== undefined && (
        <p className="dshb-action-error" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <div className="dshb-action-buttons" data-dshb-sender-inquiry-choices="">
          {inquiry.choices.map((choice) => (
            <Button
              key={choice}
              variant={choice.startsWith("allow") ? "primary" : "secondary"}
              disabled={busy !== undefined}
              marks={{ "data-dshb-sender-choice": choice }}
              onClick={() => void pick(choice)}
            >
              {busy === choice ? t("senders.answering") : choiceText(t, choice, inquiry.domain)}
            </Button>
          ))}
        </div>
      )}
    </article>
  )
}
