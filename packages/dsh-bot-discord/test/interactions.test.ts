import type { BotInteraction, BotQuestion, BotQuestionInteraction } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import type {
  DiscordButton,
  DiscordComponentPress,
  DiscordMessageEdit,
  DiscordModalSubmit,
  DiscordSelect,
  DiscordTextModal,
} from "../src/host/discord"
import { decodeCustomId, encodeCustomId } from "../src/host/interactions/custom-id"
import { createInteractionPresenter } from "../src/host/interactions/presenter"
import { MAX_CHOICES, renderCard } from "../src/host/interactions/render"
import { createSerialQueue } from "../src/host/queue"
import { ALLOWED, fakeActions, fakeLink, OTHER, settle } from "./support"

const option = (label: string) => ({ label })
const question = (id: string, options: readonly string[], multiSelect = false): BotQuestion => ({
  id,
  question: `Question ${id}?`,
  options: options.map(option),
  multiSelect,
})
const batch = (...questions: BotQuestion[]): BotQuestionInteraction => ({
  id: "k3j9x0a1b2",
  kind: "question",
  questions,
})
const APPROVAL: BotInteraction = {
  id: "ap1",
  kind: "approval",
  subject: "Notes",
  question: { en: "Allow Notes?", ja: "メモを許可しますか？" },
  actions: ["allow-once", "reject", "always"],
  allowLabel: { en: "Allow for this session" },
  delegated: false,
}
const PLAN: BotInteraction = {
  id: "pl1",
  kind: "plan-review",
  question: "Approve?",
  plan: "# Plan\n\nDo it.",
}

const buttons = (card: DiscordMessageEdit) =>
  card.components
    .flat()
    .filter((component): component is DiscordButton => component.kind === "button")
const selects = (card: DiscordMessageEdit) =>
  card.components
    .flat()
    .filter((component): component is DiscordSelect => component.kind === "select")

describe("Discord custom ids", () => {
  it("round-trip every action within Discord's 100 characters", () => {
    const actions = [
      { kind: "choose", question: 3, option: 99 },
      { kind: "select", question: 0, chunk: 3 },
      { kind: "write", question: 1 },
      { kind: "skip", question: 2 },
      { kind: "page", page: 4 },
      { kind: "submit" },
      { kind: "hold" },
      { kind: "approval", action: "always" },
      { kind: "approve-plan" },
      { kind: "decline-plan" },
    ] as const
    for (const action of actions) {
      const id = encodeCustomId("k3j9x0a1b2", action)
      expect(id.length).toBeLessThanOrEqual(100)
      expect(decodeCustomId(id)).toEqual({ interactionId: "k3j9x0a1b2", action })
    }
    expect(decodeCustomId("other:thing")).toBeUndefined()
    expect(decodeCustomId("dshb:x:a.z")).toBeUndefined()
    expect(() => encodeCustomId("bad id", { kind: "submit" })).toThrow()
  })
})

describe("Discord interaction cards", () => {
  it("shows up to five single-select choices as buttons and more as select menus of 25", () => {
    const few = renderCard(batch(question("q", ["A", "B"])), undefined, { kind: "open" }, "en")
    expect(buttons(few).map((button) => button.label)).toEqual([
      "A",
      "B",
      "Answer…".replace("Answer", "Other"),
      "Skip",
      "Submit",
    ])
    const many = Array.from({ length: 60 }, (_, at) => `Choice ${at}`)
    const big = renderCard(batch(question("q", many, true)), undefined, { kind: "open" }, "en")
    expect(
      selects(big).map((select) => [select.options.length, select.maxValues, select.minValues]),
    ).toEqual([
      [25, 25, 0],
      [25, 25, 0],
      [10, 10, 0],
    ])
    expect(selects(big)[1]?.options[0]?.value).toBe("25")
    const huge = renderCard(
      batch(
        question(
          "q",
          Array.from({ length: 130 }, (_, at) => `C${at}`),
        ),
      ),
      undefined,
      { kind: "open" },
      "ja",
    )
    expect(selects(huge).flatMap((select) => select.options)).toHaveLength(MAX_CHOICES)
    expect(huge.components.length).toBeLessThanOrEqual(5)
    expect(huge.embeds?.[0]?.description).toContain("100")
  })

  it("pages a batch, counts down with a Discord timestamp and offers to take time", () => {
    const interaction = {
      ...batch(question("a", ["A"]), question("b", [])),
      wait: { state: "counting", deadline: 1_700_000_060_000 },
    } as const
    const card = renderCard(interaction, undefined, { kind: "open" }, "en")
    expect(card.content).toContain("<t:1700000060:R>")
    expect(card.embeds?.[0]?.title).toBe("❓ Question (1/2)")
    expect(buttons(card).map((button) => button.label)).toEqual([
      "A",
      "Other…",
      "Skip",
      "Next",
      "Take time",
    ])
  })

  it("offers an approval's actions with the asker's wording, and closes with every component disabled", () => {
    const open = renderCard(APPROVAL, undefined, { kind: "open" }, "ja")
    expect(buttons(open).map((button) => [button.label, button.style])).toEqual([
      ["拒否", "danger"],
      ["Allow for this session", "success"],
      ["常に許可", "primary"],
    ])
    const closed = renderCard(
      APPROVAL,
      undefined,
      {
        kind: "closed",
        resolution: {
          kind: "answered",
          by: { via: "web" },
          answer: { kind: "approval", action: "always" },
        },
        self: "discord",
      },
      "en",
    )
    expect(closed.content).toBe("✅ Answered in the Web UI\n• Always allow")
    expect(buttons(closed).every((button) => button.disabled)).toBe(true)
  })
})

function setup(interaction: BotInteraction) {
  const link = fakeLink({ token: "t", users: [ALLOWED], approvers: [], language: "" })
  const { actions, calls } = fakeActions()
  const presenter = createInteractionPresenter({
    link: link.link,
    actions,
    recipients: async () => [{ userId: ALLOWED, channelId: `dm-${ALLOWED}` }],
    allowed: new Set([ALLOWED]),
    locale: "en",
    self: "discord",
    outbound: createSerialQueue(),
    closed: () => false,
    warn: () => {},
  })
  const updates: DiscordMessageEdit[] = []
  const replies: { content: string; ephemeral: boolean }[] = []
  const modals: DiscordTextModal[] = []
  const actor = (overrides: Partial<DiscordComponentPress> = {}) => ({
    userId: ALLOWED,
    guildId: null,
    locale: "en-US",
    channelId: `dm-${ALLOWED}`,
    ...overrides,
  })
  const press = (
    action: Parameters<typeof encodeCustomId>[1],
    overrides: Partial<DiscordComponentPress> = {},
  ) =>
    presenter.press({
      ...actor(overrides),
      customId: encodeCustomId(interaction.id, action),
      messageId: "m2",
      values: [],
      async update(message) {
        updates.push(message)
      },
      async reply(response) {
        replies.push(response)
      },
      async showModal(modal) {
        modals.push(modal)
      },
      ...overrides,
    })
  const submit = (action: Parameters<typeof encodeCustomId>[1], value: string) =>
    presenter.submit({
      ...actor(),
      customId: encodeCustomId(interaction.id, action),
      messageId: "m2",
      value,
      async update(message) {
        updates.push(message)
      },
      async reply(response) {
        replies.push(response)
      },
    } satisfies DiscordModalSubmit)
  return { link, calls, presenter, updates, replies, modals, press, submit }
}

describe("Discord interaction presenter", () => {
  it("posts a card to every allowed DM and answers an approval from its button", async () => {
    const { presenter, calls, press, link, updates } = setup(APPROVAL)
    await presenter.opened(APPROVAL)
    expect(calls).toEqual([`send dm-${ALLOWED} `])
    await press({ kind: "approval", action: "allow-once" })
    expect(link.answers).toEqual([
      { interactionId: "ap1", answer: { kind: "approval", action: "allow-once" } },
    ])
    expect(updates[0]?.content).toBe("⏳ Sending…")
    await presenter.closed({
      id: "ap1",
      kind: "approval",
      resolution: {
        kind: "answered",
        by: { via: "channel", channelId: "discord" },
        answer: { kind: "approval", action: "allow-once" },
      },
    })
    await settle()
    expect(calls.filter((call) => call.startsWith("edit"))).toEqual([
      `edit dm-${ALLOWED} m1 ✅ Answered in Discord\n• Allow once`,
      `edit dm-${ALLOWED} m2 ✅ Answered in Discord\n• Allow once`,
    ])
  })

  it("refuses others and server use privately, and closes a card of an interaction no longer open", async () => {
    const { presenter, press, replies, updates, link } = setup(APPROVAL)
    await presenter.opened(APPROVAL)
    await press({ kind: "approval", action: "reject" }, { userId: OTHER, locale: "ja" })
    await press({ kind: "approval", action: "reject" }, { guildId: "g1" })
    expect(replies).toEqual([
      { content: "このボットを使う権限がありません。", ephemeral: true },
      { content: "This bot's commands work in its direct messages only.", ephemeral: true },
    ])
    await presenter.closed({ id: "ap1", kind: "approval", resolution: { kind: "withdrawn" } })
    await press({ kind: "approval", action: "reject" })
    expect(updates.at(-1)).toEqual({
      content: "This is no longer waiting for an answer.",
      components: [],
    })
    expect(link.answers).toEqual([])
  })

  it("collects a batch's answers page by page, with text from a modal, and submits them together", async () => {
    const interaction = batch(question("a", ["A", "B"]), question("b", ["X", "Y"], true))
    const { presenter, press, submit, modals, updates, link } = setup(interaction)
    await presenter.opened(interaction)
    await press({ kind: "choose", question: 0, option: 1 })
    expect(updates.at(-1)?.embeds?.[0]?.title).toBe("❓ Question (2/2)")
    await press({ kind: "select", question: 1, chunk: 0 }, { values: ["0", "1"] })
    await press({ kind: "write", question: 1 })
    expect(modals[0]).toMatchObject({ input: { required: false } })
    await submit({ kind: "write", question: 1 }, "  and Z ")
    expect(link.answers).toEqual([])
    await press({ kind: "submit" })
    expect(link.answers).toEqual([
      {
        interactionId: interaction.id,
        answer: {
          kind: "question",
          answers: [
            { id: "a", selected: ["B"] },
            { id: "b", selected: ["X", "Y"], custom: "and Z" },
          ],
        },
      },
    ])
  })

  it("asks for a missing answer, submits a lone single-select question at once, and holds a counting wait", async () => {
    const two = batch(question("a", ["A"]), question("b", ["B"]))
    const first = setup(two)
    await first.presenter.opened(two)
    await first.press({ kind: "submit" })
    expect(first.updates.at(-1)?.content).toContain("Answer question 1 first")
    expect(first.link.answers).toEqual([])

    const lone = {
      ...batch(question("a", ["A", "B"])),
      wait: { state: "counting", deadline: 9e12 },
    } as const
    const second = setup(lone)
    await second.presenter.opened(lone)
    await second.press({ kind: "choose", question: 0, option: 0 })
    expect(second.link.holds).toEqual([lone.id])
    expect(second.link.answers).toEqual([
      {
        interactionId: lone.id,
        answer: { kind: "question", answers: [{ id: "a", selected: ["A"] }] },
      },
    ])
  })

  it("answers every press within Discord's window, even one that does not fit the card", async () => {
    const { presenter, press, submit, updates, replies, link } = setup(APPROVAL)
    await presenter.opened(APPROVAL)
    await press({ kind: "approve-plan" })
    expect(updates.at(-1)?.components.length).toBe(1)
    await submit({ kind: "write", question: 0 }, "text")
    expect(replies.at(-1)).toEqual({
      content: "This is no longer waiting for an answer.",
      ephemeral: true,
    })
    expect(link.answers).toEqual([])
  })

  it("shows a refused answer on the card and keeps it answerable", async () => {
    const { presenter, press, link, calls } = setup(APPROVAL)
    link.answerWithResult({ accepted: false, reason: "failed", message: "the bot is resuming" })
    await presenter.opened(APPROVAL)
    await press({ kind: "approval", action: "reject" })
    await settle()
    expect(calls.at(-1)).toBe(`edit dm-${ALLOWED} m2 ⚠️ Not sent: the bot is resuming`)
  })

  it("posts a plan before its card, and sends it back with optional feedback from a modal", async () => {
    const { presenter, press, submit, modals, link, calls } = setup(PLAN)
    await presenter.opened(PLAN)
    expect(calls[0]).toContain("**Plan review**")
    await press({ kind: "decline-plan" })
    expect(modals[0]).toMatchObject({ input: { required: false } })
    await submit({ kind: "decline-plan" }, "Add tests")
    expect(link.answers).toEqual([
      {
        interactionId: "pl1",
        answer: { kind: "plan-review", approved: false, feedback: "Add tests" },
      },
    ])
  })

  it("edits every card when a timed question goes on", async () => {
    const interaction = {
      ...batch(question("a", ["A"])),
      wait: { state: "counting", deadline: 9e12 },
    } as const
    const { presenter, calls } = setup(interaction)
    await presenter.opened(interaction)
    await presenter.updated({ ...interaction, wait: { state: "continued" } })
    await settle()
    expect(calls.at(-1)).toBe(`edit dm-${ALLOWED} m1 ▶️ The bot went on; you can still answer.`)
  })
})
