import { describe, expect, it } from "vitest"
import { publishCarriers } from "../src/client/interactions/carrier"
import { initialDraft, reduceDraft, submissionOf } from "../src/client/interactions/question-draft"
import type {
  SessionInteractions,
  SessionInteractionsState,
} from "../src/client/interactions/session"
import { cardsOf } from "../src/client/interactions/view"
import { createStore } from "../src/client/observable"
import type { BotInteraction, BotQuestion } from "../src/shared/interactions"

const QUESTIONS: readonly BotQuestion[] = [
  { id: "one", question: "One", options: [{ label: "A" }, { label: "B" }], multiSelect: false },
  { id: "many", question: "Many", options: [{ label: "X" }, { label: "Y" }], multiSelect: true },
  { id: "free", question: "Free", options: [], multiSelect: false },
]

describe("the Web card's question draft", () => {
  it("advances on a single choice, adds up multi-select choices and text, and asks for what is missing", () => {
    let draft = initialDraft(QUESTIONS)
    const act = (action: Parameters<typeof reduceDraft>[2]) => {
      draft = reduceDraft(QUESTIONS, draft, action)
    }
    act({ kind: "choose", question: 0, label: "B" })
    expect(draft.page).toBe(1)
    act({ kind: "choose", question: 1, label: "Y" })
    act({ kind: "choose", question: 1, label: "X" })
    act({ kind: "write", question: 1, text: "and Z" })
    expect(draft.items[1]).toEqual({ selected: ["X", "Y"], custom: "and Z", skipped: false })
    expect(submissionOf(QUESTIONS, draft)).toEqual({ kind: "incomplete", page: 2 })
    act({ kind: "write", question: 0, text: "neither" })
    expect(draft.items[0]?.selected).toEqual([])
    act({ kind: "skip", question: 2 })
    expect(submissionOf(QUESTIONS, draft)).toEqual({
      kind: "ready",
      answers: [
        { id: "one", selected: [], custom: "neither" },
        { id: "many", selected: ["X", "Y"], custom: "and Z" },
        { id: "free", selected: [] },
      ],
    })
  })
})

const approval = (id: string): BotInteraction => ({
  id,
  kind: "approval",
  question: { en: "?" },
  actions: ["allow-once", "reject"],
  delegated: false,
})

describe("the Web cards of a session", () => {
  it("puts open ones first and shows a closure only for one this page showed open and did not answer", () => {
    const snapshot = {
      sessionId: "m1",
      open: [{ interaction: approval("a"), remainingMs: 5000 }],
      closed: [
        { interaction: approval("b"), resolution: { kind: "withdrawn" } as const },
        {
          interaction: approval("c"),
          resolution: {
            kind: "answered",
            by: { via: "channel", channelId: "discord" },
            answer: { kind: "approval", action: "reject" },
          } as const,
        },
        { interaction: approval("d"), resolution: { kind: "withdrawn" } as const },
      ],
      channelNames: { discord: "Discord" },
    }
    const cards = cardsOf(
      snapshot,
      { seen: new Set(["b", "c", "d"]), dismissed: new Set(["d"]) },
      100,
    )
    expect(cards.map((card) => [card.kind, card.interaction.id])).toEqual([
      ["open", "a"],
      ["closed", "c"],
      ["closed", "b"],
    ])
    expect(cards[0]).toMatchObject({ deadline: 5100 })
    expect(cards[1]).toMatchObject({ channelName: "Discord" })
  })

  it("publishes one carrier for the first card, renewed when it changes and withdrawn when none is left", () => {
    const state = createStore<SessionInteractionsState>({ status: "loading" })
    const model = { sessionId: "m1", ...state } as unknown as SessionInteractions
    const followed = createStore<SessionInteractions | undefined>(model)
    const published: { key: string; live: boolean }[] = []
    const stop = publishCarriers(followed, (carrier) => {
      const entry = { key: carrier.key, live: true }
      published.push(entry)
      return () => {
        entry.live = false
      }
    })
    expect(published).toEqual([])
    state.set({ status: "ready", cards: [{ kind: "open", interaction: approval("a") }] })
    state.set({ status: "ready", cards: [{ kind: "open", interaction: approval("a") }] })
    state.set({
      status: "ready",
      cards: [{ kind: "closed", interaction: approval("a"), resolution: { kind: "withdrawn" } }],
    })
    expect(published).toEqual([
      { key: "bot-core:m1:open:a", live: false },
      { key: "bot-core:m1:closed:a", live: true },
    ])
    followed.set(undefined)
    expect(published.every((entry) => !entry.live)).toBe(true)
    stop()
  })
})
