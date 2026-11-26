import { describe, expect, it } from "vitest"
import { PEER_REQUEST_LABEL } from "../src/host/connectors/broker"
import { createManagedFollow } from "../src/host/managed/follow"
import { mainMessage, mainMessageLead } from "../src/host/managed/messages"
import { transcriptOf } from "../src/host/managed/transcript"
import { createNotebook } from "../src/host/notes/notebook"
import { createNotesState, createNoteTools, PINNED_LOCKED } from "../src/host/notes/tools"
import {
  createScheduleTools,
  PEER_TURN_REFUSAL as SCHEDULE_REFUSAL,
} from "../src/host/schedule/tools"
import { PEER_TURN_REFUSAL as SKILLS_REFUSAL } from "../src/host/skills/bot-skills"
import type { BotManagedSession } from "../src/shared/managed-sessions"
import { brokerSetup, call, settle } from "./connectors-support"
import { scheduleSetup } from "./schedule-support"
import { idMaker, memoryNotesFs } from "./support/notes-fs"
import { skillMd, setup as skillsSetup } from "./support/skills-setup"

const signal = new AbortController().signal

describe("a turn that took in a peer's message", () => {
  it("cannot change skills, but can list and view them", async () => {
    const { manage, peerTurns } = skillsSetup()
    await manage("main", {
      action: "create",
      name: "tidy",
      content: skillMd("tidy", "When the owner asks to tidy up."),
      reason: "asked",
    })
    peerTurns.add("main")
    expect(await manage("main", { action: "list" })).toContain("tidy")
    await expect(
      manage("main", {
        action: "create",
        name: "other",
        content: skillMd("other", "When a peer asks."),
        reason: "a peer asked",
      }),
    ).rejects.toThrow(SKILLS_REFUSAL)
  })

  it("cannot create, change or run schedule jobs, but can list them", async () => {
    const setup = scheduleSetup()
    const tools = createScheduleTools({
      caller: (_botId, _token, agentId) => ({ kind: "main", sessionId: agentId }),
      store: setup.store,
      runner: setup.runner,
      changed: () => {},
      botTimezone: () => "UTC",
      peerTurn: (agentId) => agentId === "peer-main",
      now: setup.clock.now,
      newId: () => "job-1",
      warn: () => {},
    })
    const run = (agentId: string, args: object) =>
      tools.call("a", "t", { agentId, tool: "schedule", args })
    expect((await run("peer-main", { action: "list" })).text).toBe("No jobs.")
    await expect(
      run("peer-main", {
        action: "create",
        name: "Later",
        mode: "main",
        schedule: { kind: "after", delay: "2h" },
        instruction: "Do it.",
      }),
    ).rejects.toThrow(SCHEDULE_REFUSAL)
    await expect(run("peer-main", { action: "run", id: "job-1" })).rejects.toThrow(SCHEDULE_REFUSAL)
  })

  it("cannot write, pin or unpin a pinned note, but writes unpinned notes", async () => {
    const fs = memoryNotesFs()
    const place = { fs, workspace: "/home/bot/workspace" }
    const state = createNotesState(createNotebook())
    const tools = createNoteTools({ newId: idMaker() })
    const write = (args: object, pinned: "open" | "locked") =>
      tools.call(state, place, "note_write", args, signal, pinned)
    await write(
      { action: "create", title: "Owner", type: "person", summary: "My owner.", pinned: true },
      "open",
    )
    await expect(
      write({ action: "append", note: "Owner", text: "likes tea" }, "locked"),
    ).rejects.toThrow(PINNED_LOCKED)
    await expect(
      write({ action: "update", note: "Owner", pinned: false }, "locked"),
    ).rejects.toThrow(PINNED_LOCKED)
    await expect(
      write(
        { action: "create", title: "Pinned", type: "topic", summary: "Pinned.", pinned: true },
        "locked",
      ),
    ).rejects.toThrow(PINNED_LOCKED)
    expect(
      await write(
        { action: "create", title: "Peer ask", type: "topic", summary: "A peer's ask." },
        "locked",
      ),
    ).toBe("Created Peer ask.")
  })

  it("asks the owner before an allow connector tool runs, naming the peer", async () => {
    const setup = brokerSetup()
    setup.catalog.register(setup.connector)
    await setup.enable(setup.connector)
    setup.peerTurns.set("main-1", { peerName: "Nova" })
    const pending = setup.broker.call(call("echo", { text: "hi" }), signal)
    await settle()
    const [action] = setup.ledger.list("b1")
    expect(setup.log).toEqual([])
    expect(action?.preview.fields[0]).toEqual({
      label: PEER_REQUEST_LABEL,
      value: "asked in a turn that took in a message from peer bot Nova",
    })
    await setup.broker.cancel("b1", action?.id ?? "")
    await pending
  })

  it("relays to a child as a peer's request and keeps the child's notices peer-derived", () => {
    const relay = { peerMessages: ["p_1"], peerName: "Nova" }
    const message = mainMessage(
      "Summarize it.",
      mainMessageLead({ kind: "bot" }, "Aria", relay),
      relay,
    )
    expect(message.source).toEqual({ kind: "bot-peer-relay", form: "relay", peerMessages: ["p_1"] })
    expect(message.content[0].text).toBe('Your Main session sent a message for peer bot "Nova":')
    expect(
      mainMessageLead({ kind: "bot" }, "Aria", { peerMessages: [], peerName: undefined }),
    ).toBe("Your Main session sent a message for a peer bot:")
    expect(
      transcriptOf([{ id: "m1", role: "user", content: message.content, source: message.source }], {
        limit: 10,
      }).entries,
    ).toEqual([{ id: "m1", speaker: "main", text: "Summarize it." }])

    const session: BotManagedSession = {
      botId: "a",
      sessionId: "c1",
      target: { kind: "bot" },
      answerer: "main",
      origin: "main",
      since: 1,
    }
    const told: unknown[] = []
    const follow = createManagedFollow({
      managed: (sessionId) => (sessionId === "c1" ? session : undefined),
      peerOrigin: () => ({ peerMessages: ["p_1"] }),
      tell: (_session, event, origin) => told.push({ kind: event.kind, origin }),
    })
    follow.sessionEvent("c1", {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "completed" } },
    })
    expect(told).toEqual([{ kind: "turn", origin: { peerMessages: ["p_1"] } }])
  })
})
