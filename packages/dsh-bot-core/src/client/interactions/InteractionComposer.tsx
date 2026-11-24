import { type ReactNode, useEffect, useReducer, useState } from "react"
import type { BotChannelText } from "../../shared/channels"
import type {
  BotAnswerOrigin,
  BotAnswerResult,
  BotApprovalAction,
  BotApprovalInteraction,
  BotInteractionAnswer,
  BotPlanReviewInteraction,
  BotQuestionInteraction,
} from "../../shared/interactions"
import { MarkdownView } from "../files/MarkdownView"
import { useObservable } from "../hooks"
import { IconCheck, IconChevronDown, IconChevronUp } from "../icons"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { Button, Code, Tag } from "../ui"
import type { InteractionCarrier } from "./carrier"
import { initialDraft, isAnswered, reduceDraft, submissionOf } from "./question-draft"
import type { SessionInteractions } from "./session"
import { answerSummary } from "./summary"
import type { InteractionCard } from "./view"

/** What bot-core injects into its `conversation.composer` entry. */
export interface InteractionComposerFace {
  /** The interactions of a bot session this page follows. */
  interactionsOf(sessionId: string): SessionInteractions | undefined
  /** Text in the page's language. */
  text(text: BotChannelText): string
}

export interface InteractionComposerProps extends InteractionComposerFace {
  readonly t: Translate
  readonly matched: InteractionCarrier
}

interface CardProps {
  readonly t: Translate
  readonly model: SessionInteractions
  readonly text: InteractionComposerFace["text"]
  /** Folded to its header, freeing the transcript while it stays open. */
  readonly minimized: boolean
  toggleMinimized(): void
}

/** bot-core's card in a bot session's composer seat: its first open interaction, or a closure. */
export function InteractionComposer(props: InteractionComposerProps) {
  const model = props.interactionsOf(props.matched.sessionId)
  if (model === undefined) return null
  return <SessionCards {...props} model={model} />
}

function SessionCards(props: InteractionComposerProps & { readonly model: SessionInteractions }) {
  const { t, model } = props
  const state = useObservable(model)
  if (state.status !== "ready") return null
  const [card] = state.cards
  if (card === undefined) return null
  const waiting = state.cards.filter((item) => item.kind === "open").length - 1
  return (
    <CardFrame
      key={`${card.kind}:${card.interaction.id}`}
      t={t}
      model={model}
      text={props.text}
      card={card}
      waiting={card.kind === "open" ? waiting : 0}
    />
  )
}

/** The seat's card, on the composer's width axis, as DSH's QuestionComposer. */
function CardFrame(
  props: Omit<CardProps, "minimized" | "toggleMinimized"> & {
    readonly card: InteractionCard
    readonly waiting: number
  },
) {
  const { t, card } = props
  const [minimized, setMinimized] = useState(false)
  return (
    <div className="dshb-ask-frame">
      <section
        className="dshb-ask"
        data-dshb-interaction={card.interaction.kind}
        data-state={card.kind}
        data-minimized={minimized ? "" : undefined}
        aria-live={card.kind === "closed" ? "polite" : undefined}
        aria-label={t(`ask.${card.interaction.kind}.header`)}
      >
        <CardBody
          {...props}
          minimized={minimized}
          toggleMinimized={() => setMinimized(!minimized)}
        />
        {!minimized && props.waiting > 0 ? (
          <p className="dshb-ask-more">{t("ask.more", { count: props.waiting })}</p>
        ) : null}
      </section>
    </div>
  )
}

/** The card's header: eyebrow over title, then its controls and the minimize button. */
function CardHead(props: {
  readonly t: Translate
  readonly eyebrow: ReactNode
  readonly title: string
  readonly aside?: ReactNode
  readonly minimized: boolean
  toggleMinimized(): void
}) {
  const { t, minimized } = props
  const label = t(minimized ? "ask.expand" : "ask.minimize")
  return (
    <header className="dshb-ask-head">
      <div className="dshb-ask-heading">
        <div className="dshb-ask-eyebrow">{props.eyebrow}</div>
        <p className="dshb-ask-title">{props.title}</p>
      </div>
      <div className="dshb-ask-head-actions">
        {minimized ? null : props.aside}
        <button
          type="button"
          className="dshb-ask-icon"
          aria-label={label}
          title={label}
          aria-expanded={!minimized}
          data-dshb-ask-minimize=""
          onClick={props.toggleMinimized}
        >
          {minimized ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>
    </header>
  )
}

function CardBody(props: CardProps & { readonly card: InteractionCard; readonly waiting: number }) {
  const { card } = props
  if (card.kind === "closed") return <ClosedCard {...props} card={card} />
  switch (card.interaction.kind) {
    case "question":
      return <QuestionCard {...props} interaction={card.interaction} deadline={card.deadline} />
    case "approval":
      return <ApprovalCard {...props} interaction={card.interaction} />
    case "plan-review":
      return <PlanReviewCard {...props} interaction={card.interaction} />
  }
}

/** Submit an answer; the refusal's message, if any. */
function useSubmit(model: SessionInteractions, interactionId: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const submit = async (answer: BotInteractionAnswer) => {
    setBusy(true)
    setError(undefined)
    const result: BotAnswerResult = await model.answer(interactionId, answer)
    setBusy(false)
    if (!result.accepted) setError(result.message)
  }
  return { busy, error, setError, submit }
}

function Footer(props: {
  readonly t: Translate
  readonly error: string | undefined
  readonly start?: ReactNode
  readonly children: ReactNode
}) {
  const { t, error } = props
  return (
    <footer className="dshb-ask-footer">
      <div className="dshb-ask-footer-start">{props.start}</div>
      {error === undefined ? null : (
        <p className="dshb-ask-error" role="alert">
          {t("ask.failed", { message: error })}
        </p>
      )}
      <div className="dshb-ask-footer-actions">{props.children}</div>
    </footer>
  )
}

function Countdown({ t, deadline }: { readonly t: Translate; readonly deadline: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const relative = localeFormat(t).relative(Math.max(deadline, now), now, "seconds")
  return <span>{t("ask.wait.countdown", { relative })}</span>
}

/** How long the bot waits for the answer, in the header. */
function WaitStatus(props: {
  readonly t: Translate
  readonly interaction: BotQuestionInteraction
  readonly deadline: number | undefined
  readonly onTakeTime: () => void
}) {
  const { t, interaction } = props
  const state = interaction.wait?.state
  if (state === undefined) return null
  return (
    <span className="dshb-ask-wait" data-wait={state}>
      {state === "counting" ? (
        <>
          {props.deadline !== undefined && <Countdown t={t} deadline={props.deadline} />}
          <Button variant="row" onClick={props.onTakeTime}>
            {t("ask.wait.takeTime")}
          </Button>
        </>
      ) : (
        t(`ask.wait.${state}`)
      )}
    </span>
  )
}

function Markdown({ source, className }: { readonly source: string; readonly className: string }) {
  return (
    <div className={`${className} dshb-files-markdown`}>
      <MarkdownView source={source} />
    </div>
  )
}

function QuestionCard(
  props: CardProps & {
    readonly interaction: BotQuestionInteraction
    readonly deadline: number | undefined
  },
) {
  const { t, model, interaction, minimized } = props
  const { questions } = interaction
  const [draft, dispatch] = useReducer(
    (current: ReturnType<typeof initialDraft>, action: Parameters<typeof reduceDraft>[2]) =>
      reduceDraft(questions, current, action),
    questions,
    initialDraft,
  )
  const { busy, error, setError, submit } = useSubmit(model, interaction.id)
  const hold = () => {
    if (interaction.wait?.state === "counting") model.hold(interaction.id)
  }
  const act = (action: Parameters<typeof reduceDraft>[2]) => {
    hold()
    setError(undefined)
    dispatch(action)
  }
  const page = draft.page
  const question = questions[page]
  const item = draft.items[page]
  if (question === undefined || item === undefined) return null
  const last = page === questions.length - 1
  const send = () => {
    const submission = submissionOf(questions, draft)
    if (submission.kind === "incomplete") {
      dispatch({ kind: "page", page: submission.page })
      setError(t("ask.incomplete", { n: submission.page + 1 }))
      return
    }
    void submit({ kind: "question", answers: submission.answers })
  }
  const optionless = question.options.length === 0
  return (
    <>
      <CardHead
        t={t}
        eyebrow={question.header ?? t("ask.question.header")}
        title={question.question}
        aside={
          <WaitStatus t={t} interaction={interaction} deadline={props.deadline} onTakeTime={hold} />
        }
        minimized={minimized}
        toggleMinimized={props.toggleMinimized}
      />
      {minimized ? null : (
        <>
          <div className="dshb-ask-body">
            {question.detail === undefined ? null : (
              <Markdown source={question.detail} className="dshb-ask-detail" />
            )}
            <fieldset className="dshb-ask-options" aria-label={question.question}>
              {question.options.map((option, index) => {
                const selected = item.selected.includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    className="dshb-ask-option"
                    aria-pressed={selected}
                    data-multi={question.multiSelect ? "" : undefined}
                    disabled={busy}
                    onClick={() => act({ kind: "choose", question: page, label: option.label })}
                  >
                    <span className="dshb-ask-mark" aria-hidden="true">
                      {question.multiSelect ? selected ? <IconCheck size={12} /> : null : index + 1}
                    </span>
                    <span className="dshb-ask-option-copy">
                      <span className="dshb-ask-option-label">{option.label}</span>
                      {option.description === undefined ? null : (
                        <span className="dshb-ask-option-description">{option.description}</span>
                      )}
                    </span>
                  </button>
                )
              })}
              <textarea
                className="dshb-ask-custom"
                data-block={optionless ? "" : undefined}
                aria-label={optionless ? question.question : t("ask.other")}
                placeholder={optionless ? t("ask.custom.placeholder") : t("ask.other")}
                value={item.custom}
                disabled={busy}
                rows={optionless ? 2 : 1}
                onChange={(event) =>
                  act({ kind: "write", question: page, text: event.target.value })
                }
              />
            </fieldset>
            {item.skipped ? <p className="dshb-ask-note">{t("ask.skipped")}</p> : null}
          </div>
          <Footer
            t={t}
            error={error}
            start={
              <>
                {questions.length > 1 ? (
                  <span className="dshb-ask-pager">
                    {t("ask.pager", { current: page + 1, total: questions.length })}
                  </span>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => act({ kind: "skip", question: page })}
                >
                  {t("ask.skip")}
                </Button>
              </>
            }
          >
            {page > 0 ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => dispatch({ kind: "page", page: page - 1 })}
              >
                {t("ask.prev")}
              </Button>
            ) : null}
            {last ? (
              <Button variant="primary" disabled={busy} onClick={send}>
                {t("ask.submit")}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={busy || !isAnswered(item)}
                onClick={() => dispatch({ kind: "page", page: page + 1 })}
              >
                {t("ask.next")}
              </Button>
            )}
          </Footer>
        </>
      )}
    </>
  )
}

const ACTION_ORDER: readonly BotApprovalAction[] = ["reject", "allow-once", "always"]

function ApprovalCard(props: CardProps & { readonly interaction: BotApprovalInteraction }) {
  const { t, model, interaction, text, minimized } = props
  const { busy, error, submit } = useSubmit(model, interaction.id)
  const label = (action: BotApprovalAction) =>
    action === "allow-once" && interaction.allowLabel !== undefined
      ? text(interaction.allowLabel)
      : t(`ask.approval.${action}`)
  const primary: BotApprovalAction = interaction.actions.includes("always")
    ? "always"
    : "allow-once"
  return (
    <>
      <CardHead
        t={t}
        eyebrow={
          <>
            {t("ask.approval.header")}
            {interaction.subject === undefined ? null : <Code>{interaction.subject}</Code>}
            {interaction.delegated ? <Tag>{t("ask.approval.delegated")}</Tag> : null}
          </>
        }
        title={text(interaction.question)}
        minimized={minimized}
        toggleMinimized={props.toggleMinimized}
      />
      {minimized ? null : (
        <>
          {interaction.detail === undefined ? null : (
            <div className="dshb-ask-body">
              <Markdown source={text(interaction.detail)} className="dshb-ask-detail" />
            </div>
          )}
          <Footer t={t} error={error}>
            {ACTION_ORDER.filter((action) => interaction.actions.includes(action)).map((action) => (
              <Button
                key={action}
                variant={action === primary ? "primary" : "secondary"}
                disabled={busy}
                marks={{ "data-action": action }}
                onClick={() => void submit({ kind: "approval", action })}
              >
                {label(action)}
              </Button>
            ))}
          </Footer>
        </>
      )}
    </>
  )
}

function PlanReviewCard(props: CardProps & { readonly interaction: BotPlanReviewInteraction }) {
  const { t, model, interaction, minimized } = props
  const { busy, error, submit } = useSubmit(model, interaction.id)
  const [feedback, setFeedback] = useState("")
  const trimmed = feedback.trim()
  return (
    <>
      <CardHead
        t={t}
        eyebrow={t("ask.plan-review.header")}
        title={interaction.question}
        minimized={minimized}
        toggleMinimized={props.toggleMinimized}
      />
      {minimized ? null : (
        <>
          <div className="dshb-ask-body">
            <Markdown source={interaction.plan} className="dshb-ask-plan" />
            <textarea
              className="dshb-ask-custom"
              data-block=""
              aria-label={t("ask.plan.feedback")}
              placeholder={t("ask.plan.feedback")}
              value={feedback}
              disabled={busy}
              rows={2}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </div>
          <Footer t={t} error={error}>
            <Button
              variant="secondary"
              disabled={busy}
              marks={{ "data-action": "decline" }}
              onClick={() =>
                void submit({
                  kind: "plan-review",
                  approved: false,
                  ...(trimmed === "" ? {} : { feedback: trimmed }),
                })
              }
            >
              {t("ask.plan.changes")}
            </Button>
            <Button
              variant="primary"
              disabled={busy || trimmed !== ""}
              marks={{ "data-action": "approve" }}
              onClick={() => void submit({ kind: "plan-review", approved: true })}
            >
              {t("ask.plan.approve")}
            </Button>
          </Footer>
        </>
      )}
    </>
  )
}

function closedBy(t: Translate, by: BotAnswerOrigin, channelName: string | undefined): string {
  switch (by.via) {
    case "web":
      return t("ask.closed.web")
    case "main":
      return t("ask.closed.main")
    case "channel":
      return t("ask.closed.channel", { channel: channelName ?? by.channelId })
  }
}

function ClosedCard(
  props: CardProps & { readonly card: Extract<InteractionCard, { kind: "closed" }> },
) {
  const { t, model, card, minimized } = props
  const { resolution } = card
  const message =
    resolution.kind === "withdrawn"
      ? t("ask.closed.withdrawn")
      : closedBy(t, resolution.by, card.channelName)
  const summary =
    resolution.kind === "answered" ? answerSummary(t, card.interaction, resolution.answer) : []
  return (
    <>
      <CardHead
        t={t}
        eyebrow={t(`ask.${card.interaction.kind}.header`)}
        title={message}
        minimized={minimized}
        toggleMinimized={props.toggleMinimized}
      />
      {minimized ? null : (
        <>
          {summary.length === 0 ? null : (
            <div className="dshb-ask-body">
              <ul className="dshb-ask-summary" data-resolution={resolution.kind}>
                {summary.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          <Footer t={t} error={undefined}>
            <Button variant="secondary" onClick={() => model.dismiss(card.interaction.id)}>
              {t("ask.closed.dismiss")}
            </Button>
          </Footer>
        </>
      )}
    </>
  )
}
