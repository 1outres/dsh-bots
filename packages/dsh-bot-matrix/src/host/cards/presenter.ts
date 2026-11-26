import type {
  BotChannelLink,
  BotInteraction,
  BotInteractionAnswer,
  BotInteractionClosure,
} from "@1outres/dsh-bot-core"
import type { SerialQueue } from "../queue"
import type { RoomPoster } from "../room"
import { fill, type MatrixLocale, OWNERS_ONLY } from "../texts"
import { replyAnswer } from "./answers"
import { answersOf, choose, newDraft, type QuestionDraft, skip, write } from "./draft"
import { approvalOfKey, digitOf, HOLD, REJECT } from "./keys"
import { type CardState, renderCard, singleChoice } from "./render"

export interface CardPresenterDeps {
  readonly link: Pick<BotChannelLink, "answer" | "hold">
  readonly poster: RoomPoster
  readonly owners: ReadonlySet<string>
  readonly anyoneAnswersQuestions: boolean
  readonly self: string
  readonly locale: MatrixLocale
  readonly outbound: SerialQueue
  closed(): boolean
  warn(message: string): void
}

export interface CardPresenter {
  opened(interaction: BotInteraction): Promise<void>
  updated(interaction: BotInteraction): Promise<void>
  closed(closure: BotInteractionClosure): Promise<void>
  react(target: string, key: string, sender: string): boolean
  reply(target: string, text: string, sender: string, replyEventId: string): boolean
}

interface Card {
  interaction: BotInteraction
  eventId: string | undefined
  draft: QuestionDraft
  readonly seeds: Map<string, string>
  readonly warned: Set<string>
  sending: boolean
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createCardPresenter(deps: CardPresenterDeps): CardPresenter {
  const showing = new Map<string, Card>()
  const byEvent = new Map<string, string>()
  const { poster, locale } = deps
  const guard = (what: string) => (error: unknown) => {
    if (!deps.closed()) deps.warn(`bot-matrix: could not ${what}: ${messageOf(error)}`)
  }

  const reseed = async (card: Card, wanted: readonly string[]) => {
    if (card.eventId === undefined) return
    for (const [key, seed] of [...card.seeds]) {
      if (wanted.includes(key)) continue
      card.seeds.delete(key)
      await poster.redact(seed).catch(guard("take back a reaction"))
    }
    for (const key of wanted) {
      if (card.seeds.has(key)) continue
      card.seeds.set(key, await poster.react(card.eventId, key))
    }
  }

  const show = (card: Card, state: CardState) =>
    deps.outbound.push(async () => {
      if (deps.closed() || card.eventId === undefined) return
      const rendered = renderCard(card.interaction, card.draft, state, locale)
      await poster.edit(card.eventId, rendered.markdown)
      await reseed(card, rendered.seeds)
    })

  const answered = async (card: Card, answer: BotInteractionAnswer) => {
    card.sending = true
    const result = await deps.link.answer(card.interaction.id, answer)
    card.sending = false
    if (!result.accepted && showing.get(card.interaction.id) === card) {
      await show(card, { kind: "open", refusal: result.message })
    }
  }

  const allowed = async (card: Card, sender: string, replyTo: string | undefined) => {
    if (card.interaction.kind === "question" && deps.anyoneAnswersQuestions) return true
    if (deps.owners.has(sender)) return true
    if (!card.warned.has(sender)) {
      card.warned.add(sender)
      await deps.outbound.push(async () => {
        await poster
          .notice(fill(OWNERS_ONLY, locale), replyTo ?? card.eventId)
          .catch(guard("say who may answer"))
      })
    }
    return false
  }

  const advance = async (card: Card, draft: QuestionDraft) => {
    if (card.interaction.kind !== "question") return
    card.draft = draft
    const outcome = answersOf(card.interaction.questions, draft)
    if ("answers" in outcome) {
      await answered(card, { kind: "question", answers: outcome.answers })
      return
    }
    await show(card, { kind: "open" })
  }

  const hold = (card: Card) => {
    if (card.interaction.kind !== "question" || card.interaction.wait?.state !== "counting") return
    deps.link.hold(card.interaction.id).catch(guard("hold a question"))
  }

  const onReaction = async (card: Card, key: string, sender: string) => {
    if (!(await allowed(card, sender, undefined))) return
    const { interaction } = card
    switch (interaction.kind) {
      case "approval": {
        const action = approvalOfKey(key)
        if (action !== undefined && interaction.actions.includes(action))
          await answered(card, { kind: "approval", action })
        return
      }
      case "plan-review":
        if (approvalOfKey(key) === "allow-once")
          await answered(card, { kind: "plan-review", approved: true })
        if (key === REJECT) await answered(card, { kind: "plan-review", approved: false })
        return
      case "question": {
        if (key === HOLD) {
          hold(card)
          return
        }
        const digit = digitOf(key)
        const page = card.draft.page
        const label =
          digit === undefined ? undefined : interaction.questions[page]?.options[digit]?.label
        if (label === undefined || !singleChoice(interaction, page)) return
        hold(card)
        await advance(card, choose(interaction.questions, card.draft, page, label))
      }
    }
  }

  const onReply = async (card: Card, text: string, sender: string, replyEventId: string) => {
    if (!(await allowed(card, sender, replyEventId))) return
    const { interaction } = card
    if (interaction.kind === "plan-review") {
      const feedback = text.trim()
      await answered(card, {
        kind: "plan-review",
        approved: false,
        ...(feedback === "" ? {} : { feedback }),
      })
      return
    }
    if (interaction.kind !== "question") return
    const page = card.draft.page
    const question = interaction.questions[page]
    if (question === undefined) return
    const parsed = replyAnswer(question, text)
    if (parsed === undefined) return
    hold(card)
    const { questions } = interaction
    switch (parsed.kind) {
      case "skip":
        return advance(card, skip(questions, card.draft, page))
      case "write":
        return advance(card, write(questions, card.draft, page, parsed.text))
      case "choose": {
        let draft = card.draft
        if (question.multiSelect) {
          draft = {
            ...draft,
            items: draft.items.map((item, at) =>
              at === page ? { selected: [], skipped: false } : item,
            ),
          }
          for (const label of parsed.labels) draft = choose(questions, draft, page, label)
          const next = draft.items.findIndex(
            (item, at) =>
              at > page && !item.skipped && item.selected.length === 0 && item.custom === undefined,
          )
          draft = { ...draft, page: next < 0 ? page : next }
        } else {
          draft = choose(questions, draft, page, parsed.labels[0] as string)
        }
        return advance(card, draft)
      }
    }
  }

  const route = (target: string, run: (card: Card) => Promise<void>) => {
    const id = byEvent.get(target)
    const card = id === undefined ? undefined : showing.get(id)
    if (card === undefined) return false
    if (!card.sending) run(card).catch(guard("take an answer to a card"))
    return true
  }

  return {
    async opened(interaction) {
      const questions = interaction.kind === "question" ? interaction.questions : []
      const card: Card = {
        interaction,
        eventId: undefined,
        draft: newDraft(questions),
        seeds: new Map(),
        warned: new Set(),
        sending: false,
      }
      showing.set(interaction.id, card)
      await deps.outbound.push(async () => {
        if (deps.closed() || showing.get(interaction.id) !== card) return
        try {
          const rendered = renderCard(interaction, card.draft, { kind: "open" }, locale)
          card.eventId = await poster.text(rendered.markdown)
          byEvent.set(card.eventId, interaction.id)
          await reseed(card, rendered.seeds)
        } catch (error) {
          guard("post a card")(error)
        }
      })
    },
    async updated(interaction) {
      const card = showing.get(interaction.id)
      if (card === undefined) return
      card.interaction = interaction
      await show(card, { kind: "open" })
    },
    async closed(closure) {
      const card = showing.get(closure.id)
      if (card === undefined) return
      showing.delete(closure.id)
      if (card.eventId !== undefined) byEvent.delete(card.eventId)
      await show(card, { kind: "closed", resolution: closure.resolution, self: deps.self })
      await deps.outbound.push(() => reseed(card, []))
    },
    react: (target, key, sender) => route(target, (card) => onReaction(card, key, sender)),
    reply: (target, text, sender, replyEventId) =>
      route(target, (card) => onReply(card, text, sender, replyEventId)),
  }
}
