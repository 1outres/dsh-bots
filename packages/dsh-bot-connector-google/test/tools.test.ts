import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { actionViews } from "../../dsh-bot-core/test/connections-support"
import {
  approve,
  ask,
  call,
  googleSetup,
  ready,
  signal,
  signIn,
  startWorld,
  world,
} from "./support"

const fake = world.fake
beforeAll(startWorld)
afterAll(() => fake.close())

const ACCOUNT = { account: "alice@example.com" }

async function aliceSetup() {
  const setup = googleSetup()
  await signIn(setup, "alice@example.com")
  await ready(setup)
  const run = (connectorId: string, tool: string, args: Record<string, unknown> = {}) =>
    setup.broker.call(call(connectorId, tool, { ...ACCOUNT, ...args }), signal())
  const decide = async (connectorId: string, tool: string, args: Record<string, unknown>) => {
    await ask(setup, call(connectorId, tool, { ...ACCOUNT, ...args }))
    const action = setup.ledger.list("b1").at(-1)
    return { action, done: await approve(setup, action?.id ?? "") }
  }
  return { setup, run, decide }
}

describe("every Gmail tool against the fake Google", () => {
  it("reads threads and attachments, keeps drafts, labels and filters, and asks before deleting any of them", async () => {
    const { setup, run, decide } = await aliceSetup()
    setup.environment.files.set(
      "/home/bot/workspace/notes.txt",
      new TextEncoder().encode("attached notes"),
    )
    await decide("gmail", "send", {
      to: ["alice@example.com"],
      subject: "Notes",
      body: "here",
      attachments: ["notes.txt"],
    })
    const sent = fake.sent("alice@example.com").at(-1)
    const message = await run("gmail", "get_message", { message_id: sent?.id })
    expect(message.text).toContain("notes.txt (text/plain")
    const attachmentId = /notes\.txt \(text\/plain, [^,]+, id ([^)]+)\)/.exec(message.text)?.[1]
    await run("gmail", "get_attachment", {
      message_id: sent?.id,
      attachment_id: attachmentId,
      path: "saved/notes.txt",
    })
    expect(
      new TextDecoder().decode(setup.environment.files.get("/home/bot/workspace/saved/notes.txt")),
    ).toBe("attached notes")
    const thread = await run("gmail", "get_thread", { thread_id: sent?.threadId })
    expect(thread.text).toContain("Subject: Notes")

    const draft = await run("gmail", "create_draft", {
      to: ["bob@example.com"],
      subject: "Draft one",
      body: "first",
    })
    const draftId = (draft.data as { result: { id: string } }).result.id
    await run("gmail", "update_draft", {
      draft_id: draftId,
      to: ["bob@example.com"],
      subject: "Draft two",
      body: "second",
    })
    expect((await run("gmail", "get_draft", { draft_id: draftId })).text).toContain(
      "Subject: Draft two",
    )
    expect((await run("gmail", "list_drafts")).text).toContain("Draft two")
    const deleted = await decide("gmail", "delete_draft", { draft_id: draftId })
    expect(deleted.action?.preview.fields).toContainEqual({ label: "Subject", value: "Draft two" })
    expect(deleted.done?.status.state).toBe("succeeded")

    const label = await run("gmail", "create_label", { name: "Receipts" })
    const labelId = (label.data as { result: { id: string } }).result.id
    await run("gmail", "update_label", { label_id: labelId, name: "Receipts 2026" })
    expect((await run("gmail", "list_labels")).text).toContain("Receipts 2026")
    const removed = await decide("gmail", "delete_label", { label_id: labelId })
    expect(removed.action?.preview.fields[1]).toEqual({
      label: "Label",
      value: `Receipts 2026 (${labelId})`,
    })
    expect(removed.done?.status.state).toBe("succeeded")

    const filter = await decide("gmail", "create_filter", {
      from: "news@example.com",
      remove_label_ids: ["INBOX"],
      forward: "archive@example.com",
    })
    expect(filter.action?.preview.fields).toContainEqual({
      label: "Forward every match to",
      value: "archive@example.com",
    })
    const status = filter.done?.status
    if (status?.state !== "succeeded") throw new Error("the filter was not created")
    const filterId = (status.result as { readonly id: string }).id
    expect((await run("gmail", "list_filters")).text).toContain("news@example.com")
    expect(
      (await decide("gmail", "delete_filter", { filter_id: filterId })).done?.status.state,
    ).toBe("succeeded")

    const trashed = await decide("gmail", "trash", { message_id: sent?.id })
    expect(trashed.done?.status.state).toBe("succeeded")
    expect(
      fake.accounts.get("alice@example.com")?.messages.get(sent?.id ?? "")?.labelIds,
    ).toContain("TRASH")
    expect((await decide("gmail", "untrash", { message_id: sent?.id })).done?.status.state).toBe(
      "succeeded",
    )
    expect(
      fake.accounts.get("alice@example.com")?.messages.get(sent?.id ?? "")?.labelIds,
    ).not.toContain("TRASH")
  })
})

describe("every Calendar tool against the fake Google", () => {
  it("lists, searches and checks free time, and asks before changing or deleting an event with guests", async () => {
    const { run, decide } = await aliceSetup()
    expect((await run("gcal", "list_calendars")).text).toContain(
      "alice@example.com (owner, primary)",
    )
    const shared = fake.insertEvent(
      "alice@example.com",
      {
        summary: "Planning",
        start: { dateTime: "2026-12-10T10:00:00+09:00" },
        end: { dateTime: "2026-12-10T11:00:00+09:00" },
        attendees: [{ email: "alice@example.com" }, { email: "dan@example.org" }],
      },
      "alice@example.com",
    )
    const listed = await run("gcal", "list_events", {
      time_min: "2026-12-10T00:00:00+09:00",
      time_max: "2026-12-11T00:00:00+09:00",
    })
    expect(listed.text).toContain("Planning")
    expect((await run("gcal", "search_events", { query: "plan" })).text).toContain(shared.id)
    expect((await run("gcal", "get_event", { event_id: shared.id })).text).toContain(
      "dan@example.org",
    )
    const busy = await run("gcal", "freebusy", {
      time_min: "2026-12-10T00:00:00+09:00",
      time_max: "2026-12-11T00:00:00+09:00",
    })
    expect(busy.text).toContain("2026-12-10T10:00:00+09:00")
    const update = await decide("gcal", "update_event", {
      event_id: shared.id,
      summary: "Planning (moved)",
      start: "2026-12-10T13:00:00+09:00",
      end: "2026-12-10T14:00:00+09:00",
      send_updates: "all",
    })
    expect(update.action?.preview.fields).toContainEqual({ label: "Now: title", value: "Planning" })
    expect(update.action?.preview.fields).toContainEqual({
      label: "New: title",
      value: "Planning (moved)",
    })
    expect(update.done?.status.state).toBe("succeeded")
    const gone = await decide("gcal", "delete_event", { event_id: shared.id, send_updates: "all" })
    expect(gone.action?.preview.fields).toContainEqual({
      label: "title",
      value: "Planning (moved)",
    })
    expect(gone.done?.status.state).toBe("succeeded")
    expect((await run("gcal", "get_event", { event_id: shared.id })).data).toMatchObject({
      result: { status: "cancelled" },
    })
  })

  it("refuses an approved change when the event changed after the preview", async () => {
    const { setup, run } = await aliceSetup()
    const created = await run("gcal", "create_personal_event", {
      summary: "Solo",
      start: "2026-12-12",
      end: "2026-12-13",
    })
    const id = (created.data as { result: { id: string } }).result.id
    await ask(
      setup,
      call("gcal", "delete_event", { ...ACCOUNT, event_id: id, send_updates: "none" }),
    )
    const action = setup.ledger.list("b1").at(-1)
    await run("gcal", "update_personal_event", { event_id: id, summary: "Solo (edited)" })
    const done = await approve(setup, action?.id ?? "")
    expect(done?.status).toMatchObject({
      state: "failed",
      reason: expect.stringContaining("changed since it was shown"),
    })
  })
})

describe("the action a channel's approvers see", () => {
  it("names the tool, starts its preview with the account and keeps every field short enough for a card", async () => {
    const { setup, decide } = await aliceSetup()
    const incoming = fake.deliver("alice@example.com", {
      from: "Dave <dave@example.net>",
      subject: "Lunch?",
      text: "Friday?",
    })
    await ask(
      setup,
      call("gmail", "reply", {
        ...ACCOUNT,
        message_id: incoming.id,
        body: "Yes.",
        reply_all: false,
        quote: true,
      }),
    )
    await decide("gcal", "create_event_with_attendees", {
      summary: "Kickoff",
      start: "2026-12-03T10:00:00+09:00",
      end: "2026-12-03T11:00:00+09:00",
      attendees: ["bob@example.com"],
      send_updates: "all",
    })
    const views = actionViews(setup, "b1")
    expect(
      views.map((view) => [view.toolName, view.connector.name, view.preview.fields[0]]),
    ).toEqual([
      ["gmail_reply", "Gmail", { label: "Account", value: "alice@example.com" }],
      [
        "gcal_create_event_with_attendees",
        "Google Calendar",
        { label: "Account", value: "alice@example.com" },
      ],
    ])
    for (const view of views) {
      for (const field of view.preview.fields)
        expect([...field.value].length).toBeLessThanOrEqual(300)
    }
  })
})
