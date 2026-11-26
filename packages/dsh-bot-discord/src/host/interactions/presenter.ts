import type {
  BotAnswerResult,
  BotChannelLink,
  BotInteraction,
  BotInteractionAnswer,
  BotInteractionClosure,
} from "@1outres/dsh-bot-core"
import type {
  DiscordActions,
  DiscordActor,
  DiscordComponentPress,
  DiscordMessageEdit,
  DiscordModalSubmit,
} from "../discord"
import type { DiscordPlace } from "../home"
import type { HomeTarget } from "../home-target"
import type { SerialQueue } from "../queue"
import { type DiscordLocale, localeOf, notHomeText, ownersOnlyText } from "../texts"
import { decodeCustomId, type InteractionAction } from "./custom-id"
import {
  answersOf,
  choose,
  goTo,
  newDraft,
  type QuestionDraft,
  selectIn,
  skip,
  withNotice,
  write,
} from "./draft"
import { type CardState, clip, leadingMessages, renderCard, staleCard } from "./render"
import { text } from "./texts"

export const MODAL_TEXT_LIMIT = 4000
const MODAL_PLACEHOLDER_LIMIT = 100

export interface InteractionPresenterDeps {
  link: Pick<BotChannelLink, "answer" | "hold">
  actions: Pick<DiscordActions, "send" | "edit">
  home: HomeTarget
  atHome(place: DiscordPlace): boolean
  owners: ReadonlySet<string>
  locale: DiscordLocale
  self: string
  outbound: SerialQueue
  closed(): boolean
  warn(message: string): void
}

export interface InteractionPresenter {
  opened(interaction: BotInteraction): Promise<void>
  updated(interaction: BotInteraction): Promise<void>
  closed(closure: BotInteractionClosure): Promise<void>
  press(press: DiscordComponentPress): Promise<void>
  submit(submit: DiscordModalSubmit): Promise<void>
}

interface Card {
  readonly channelId: string
  readonly messageId: string
}

interface Held {
  interaction: BotInteraction
  readonly cards: Card[]
  draft: QuestionDraft | undefined
}

interface Response {
  readonly actor: DiscordActor
  readonly messageId: string | null
  update(message: DiscordMessageEdit): Promise<void>
  reply(response: { content: string; ephemeral: boolean }): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createInteractionPresenter(deps: InteractionPresenterDeps): InteractionPresenter {
  const held = new Map<string, Held>()
  const { locale } = deps

  const draftOf = (entry: Held): QuestionDraft | undefined =>
    entry.interaction.kind === "question"
      ? (entry.draft ?? newDraft(entry.interaction.questions))
      : undefined

  const editAll = (entry: Held, state: CardState) =>
    deps.outbound.push(async () => {
      for (const card of [...entry.cards]) {
        if (deps.closed()) return
        await deps.actions
          .edit(
            card.channelId,
            card.messageId,
            renderCard(entry.interaction, draftOf(entry), state, locale),
          )
          .catch((error: unknown) => {
            if (!deps.closed())
              deps.warn(`bot-discord: could not update an interaction card: ${messageOf(error)}`)
          })
      }
    })

  const away = async (response: Response): Promise<boolean> => {
    if (deps.atHome(response.actor)) return false
    await response.reply({ content: notHomeText(localeOf(response.actor.locale)), ephemeral: true })
    return true
  }

  const notOwner = async (entry: Held, response: Response): Promise<boolean> => {
    if (entry.interaction.kind === "question" || deps.owners.has(response.actor.userId))
      return false
    await response.reply({
      content: ownersOnlyText(localeOf(response.actor.locale)),
      ephemeral: true,
    })
    return true
  }

  const entryOf = (interactionId: string, response: Response): Held | undefined => {
    const entry = held.get(interactionId)
    if (entry === undefined || response.messageId === null) return entry
    const { messageId } = response
    if (!entry.cards.some((card) => card.messageId === messageId)) {
      entry.cards.push({ channelId: response.actor.channelId, messageId })
    }
    return entry
  }

  const holdIfCounting = (entry: Held) => {
    if (entry.interaction.kind !== "question" || entry.interaction.wait?.state !== "counting")
      return
    deps.link.hold(entry.interaction.id).catch((error: unknown) => {
      deps.warn(`bot-discord: could not hold a question: ${messageOf(error)}`)
    })
  }

  const show = (entry: Held, response: Response, draft: QuestionDraft | undefined) => {
    if (draft !== undefined) entry.draft = draft
    return response.update(renderCard(entry.interaction, draft, { kind: "open" }, locale))
  }

  const deliver = async (
    entry: Held,
    response: Response,
    draft: QuestionDraft | undefined,
    answer: BotInteractionAnswer,
  ) => {
    await response.update(renderCard(entry.interaction, draft, { kind: "sending" }, locale))
    const result: BotAnswerResult = await deps.link.answer(entry.interaction.id, answer)
    if (result.accepted || response.messageId === null || deps.closed()) return
    const { channelId } = response.actor
    const messageId = response.messageId
    if (!held.has(entry.interaction.id)) return
    const edit =
      result.reason === "closed"
        ? staleCard(locale)
        : renderCard(entry.interaction, draft, { kind: "open", refusal: result.message }, locale)
    await deps.outbound.push(async () => {
      await deps.actions.edit(channelId, messageId, edit)
    })
  }

  const submitDraft = (entry: Held, response: Response, draft: QuestionDraft) => {
    if (entry.interaction.kind !== "question") return
    const outcome = answersOf(entry.interaction.questions, draft)
    if ("missing" in outcome) {
      return show(
        entry,
        response,
        withNotice(goTo(entry.interaction.questions, draft, outcome.missing), {
          kind: "incomplete",
          question: outcome.missing,
        }),
      )
    }
    return deliver(entry, response, draft, { kind: "question", answers: outcome.answers })
  }

  const settleChoice = (entry: Held, response: Response, draft: QuestionDraft) => {
    if (entry.interaction.kind !== "question") return
    const [only] = entry.interaction.questions
    const auto = entry.interaction.questions.length === 1 && only !== undefined && !only.multiSelect
    return auto
      ? submitDraft(entry, response, draft)
      : show(entry, response, withNotice(draft, undefined))
  }

  const modalFor = (entry: Held, action: InteractionAction, customId: string) => {
    if (action.kind === "decline-plan") {
      return {
        customId,
        title: text("feedbackTitle", locale),
        input: {
          label: text("feedbackLabel", locale),
          required: false,
          maxLength: MODAL_TEXT_LIMIT,
        },
      }
    }
    if (action.kind !== "write" || entry.interaction.kind !== "question") return undefined
    const question = entry.interaction.questions[action.question]
    if (question === undefined) return undefined
    const value = draftOf(entry)?.items[action.question]?.custom
    return {
      customId,
      title: text("modalTitle", locale),
      input: {
        label: text("modalLabel", locale),
        required: question.options.length === 0,
        maxLength: MODAL_TEXT_LIMIT,
        ...(value === undefined ? {} : { value }),
        placeholder: clip(question.question, MODAL_PLACEHOLDER_LIMIT),
      },
    }
  }

  async function onPress(press: DiscordComponentPress) {
    const response: Response = {
      actor: press,
      messageId: press.messageId,
      update: press.update,
      reply: press.reply,
    }
    if (await away(response)) return
    const decoded = decodeCustomId(press.customId)
    if (decoded === undefined) return press.update(staleCard(locale))
    const entry = entryOf(decoded.interactionId, response)
    if (entry === undefined) return press.update(staleCard(locale))
    if (await notOwner(entry, response)) return
    const { action } = decoded
    const { interaction } = entry
    const modal = modalFor(entry, action, press.customId)
    if (modal !== undefined) {
      holdIfCounting(entry)
      return press.showModal(modal)
    }
    const current = () => show(entry, response, draftOf(entry))
    if (interaction.kind === "approval") {
      if (action.kind !== "approval") return current()
      return deliver(entry, response, undefined, { kind: "approval", action: action.action })
    }
    if (interaction.kind === "plan-review") {
      if (action.kind !== "approve-plan") return current()
      return deliver(entry, response, undefined, { kind: "plan-review", approved: true })
    }
    const { questions } = interaction
    const draft = draftOf(entry) ?? newDraft(questions)
    switch (action.kind) {
      case "choose": {
        const label = questions[action.question]?.options[action.option]?.label
        if (label === undefined) return current()
        holdIfCounting(entry)
        return settleChoice(entry, response, choose(questions, draft, action.question, label))
      }
      case "select": {
        const question = questions[action.question]
        if (question === undefined) return current()
        const start = action.chunk * 25
        const labels = question.options.slice(start, start + 25).map((option) => option.label)
        const chosen = press.values.flatMap((value) => {
          const label = question.options[Number(value)]?.label
          return label === undefined ? [] : [label]
        })
        holdIfCounting(entry)
        const next = selectIn(questions, draft, action.question, labels, chosen)
        return question.multiSelect
          ? show(entry, response, withNotice(next, undefined))
          : settleChoice(entry, response, next)
      }
      case "skip":
        holdIfCounting(entry)
        return settleChoice(entry, response, skip(questions, draft, action.question))
      case "page":
        return show(entry, response, withNotice(goTo(questions, draft, action.page), undefined))
      case "submit":
        return submitDraft(entry, response, draft)
      case "hold":
        holdIfCounting(entry)
        return show(entry, response, draft)
      default:
        return current()
    }
  }

  async function onSubmit(submit: DiscordModalSubmit) {
    const response: Response = {
      actor: submit,
      messageId: submit.messageId,
      update: submit.update,
      reply: submit.reply,
    }
    if (await away(response)) return
    const decoded = decodeCustomId(submit.customId)
    if (decoded === undefined)
      return submit.reply({ content: text("notOpen", localeOf(submit.locale)), ephemeral: true })
    const entry = entryOf(decoded.interactionId, response)
    if (entry === undefined)
      return submit.reply({ content: text("notOpen", localeOf(submit.locale)), ephemeral: true })
    if (await notOwner(entry, response)) return
    const { action } = decoded
    const { interaction } = entry
    if (action.kind === "decline-plan" && interaction.kind === "plan-review") {
      const feedback = submit.value.trim()
      return deliver(entry, response, undefined, {
        kind: "plan-review",
        approved: false,
        ...(feedback === "" ? {} : { feedback }),
      })
    }
    if (action.kind !== "write" || interaction.kind !== "question")
      return submit.reply({ content: text("notOpen", localeOf(submit.locale)), ephemeral: true })
    const draft = draftOf(entry) ?? newDraft(interaction.questions)
    return settleChoice(
      entry,
      response,
      write(interaction.questions, draft, action.question, submit.value),
    )
  }

  const guarded =
    <T>(what: string, run: (value: T) => Promise<void> | undefined) =>
    async (value: T) => {
      try {
        await run(value)
      } catch (error) {
        if (!deps.closed()) deps.warn(`bot-discord: could not answer ${what}: ${messageOf(error)}`)
      }
    }

  return {
    async opened(interaction) {
      const entry: Held = { interaction, cards: [], draft: undefined }
      held.set(interaction.id, entry)
      await deps.outbound.push(async () => {
        if (deps.closed() || held.get(interaction.id) !== entry) return
        try {
          const { channelId } = await deps.home.channel()
          for (const content of leadingMessages(interaction, locale)) {
            await deps.actions.send(channelId, { content })
          }
          const card = renderCard(entry.interaction, draftOf(entry), { kind: "open" }, locale)
          const messageId = await deps.actions.send(channelId, {
            content: card.content,
            embeds: card.embeds ?? [],
            components: card.components,
          })
          entry.cards.push({ channelId, messageId })
        } catch (error) {
          if (!deps.closed())
            deps.warn(`bot-discord: could not post an interaction: ${messageOf(error)}`)
        }
      })
    },
    async updated(interaction) {
      const entry = held.get(interaction.id)
      if (entry === undefined) return
      entry.interaction = interaction
      await editAll(entry, { kind: "open" })
    },
    async closed(closure) {
      const entry = held.get(closure.id)
      if (entry === undefined) return
      held.delete(closure.id)
      await editAll(entry, { kind: "closed", resolution: closure.resolution, self: deps.self })
    },
    press: guarded("a button", onPress),
    submit: guarded("a form", onSubmit),
  }
}
