import { describe, expect, it } from "vitest"
import { type ControlChange, DesktopControl } from "../src/host/control"
import { awaitHandoff, outcomeText } from "../src/host/tools/handoff"
import { parseScreenUp } from "../src/shared/screen"

const changesOf = (control: DesktopControl) => {
  const changes: ControlChange["kind"][] = []
  control.subscribe((_botId, change) => changes.push(change.kind))
  return changes
}

describe("DesktopControl", () => {
  it("gives the input to one viewer at a time and back to the agent", () => {
    let now = 0
    const control = new DesktopControl(() => now)
    const changes = changesOf(control)
    const a = Symbol("a")
    const b = Symbol("b")
    expect(control.viewOf("b1", a)).toBe("agent")
    now = 5
    control.take("b1", a)
    expect(control.view("b1")).toEqual({ controller: "human", since: 5 })
    expect(control.viewOf("b1", a)).toBe("self")
    expect(control.viewOf("b1", b)).toBe("other")
    control.take("b1", b)
    expect(control.holds("b1", a)).toBe(false)
    control.release("b1", a, "handed-back")
    expect(control.view("b1").controller).toBe("human")
    now = 9
    control.release("b1", b, "viewer-left")
    expect(control.view("b1")).toEqual({ controller: "agent", since: 9 })
    expect(control.takeNotices("b1")).toEqual(["control-returned"])
    expect(control.takeNotices("b1")).toEqual([])
    expect(changes).toEqual(["taken", "taken", "returned"])
    expect(control.view("b2").controller).toBe("agent")
  })

  it("reports a person operating and the bot's request as the connector's status", () => {
    const control = new DesktopControl(() => 1)
    const viewer = Symbol("v")
    expect(control.status("b1")).toEqual({})
    const request = control.request("b1", "log in")
    expect(() => control.request("b1", "again")).toThrow(/^HANDOFF_PENDING/)
    control.take("b1", viewer)
    expect(control.status("b1")).toEqual({
      note: expect.objectContaining({ en: expect.stringMatching(/person is operating/) }),
      operatedBy: "person",
      request,
    })
    control.endRequest("b1", request.id)
    control.release("b1", viewer, "handed-back")
    expect(control.status("b1")).toEqual({})
  })
})

function manualDeadlines() {
  const pending: AbortController[] = []
  return {
    deadline: () => {
      const controller = new AbortController()
      pending.push(controller)
      return controller.signal
    },
    expire: () => {
      for (const controller of pending.splice(0)) controller.abort()
    },
  }
}

describe("desktop_request_handoff's wait", () => {
  const setup = () => {
    let now = 0
    const control = new DesktopControl(() => now)
    const deadlines = manualDeadlines()
    const turn = new AbortController()
    const wait = awaitHandoff(
      { control, deadline: deadlines.deadline, now: () => now },
      "b1",
      "Log in to the bank",
      600_000,
      turn.signal,
    )
    return { control, deadlines, turn, wait, advance: (ms: number) => (now += ms) }
  }

  it("asks, then answers once the person took over and handed it back", async () => {
    const { control, wait, advance } = setup()
    expect(control.view("b1").request?.reason).toBe("Log in to the bank")
    const viewer = Symbol("v")
    control.take("b1", viewer)
    advance(42_000)
    control.release("b1", viewer, "handed-back")
    const outcome = await wait
    expect(outcome).toEqual({ kind: "returned", how: "handed-back", tookMs: 42_000 })
    expect(outcomeText(outcome)).toMatch(/handed the desktop back after 42 s/)
    expect(control.view("b1").request).toBeUndefined()
  })

  it("answers when the person's viewer closed while they held the input", async () => {
    const { control, wait } = setup()
    const viewer = Symbol("v")
    control.take("b1", viewer)
    control.release("b1", viewer, "viewer-left")
    expect(await wait).toMatchObject({ kind: "returned", how: "viewer-left" })
  })

  it("answers a decline, and a wait that ran out", async () => {
    const first = setup()
    first.control.decline("b1")
    expect(await first.wait).toEqual({ kind: "declined" })
    const second = setup()
    second.deadlines.expire()
    expect(await second.wait).toEqual({ kind: "timed-out", personInControl: false })
    expect(second.control.view("b1").request).toBeUndefined()
  })

  it("stops waiting when the turn stops, and clears the request", async () => {
    const { control, wait, turn } = setup()
    turn.abort(new Error("stopped"))
    await expect(wait).rejects.toThrow("stopped")
    expect(control.view("b1").request).toBeUndefined()
  })
})

describe("the screen stream's uplink", () => {
  it("takes control items and base64 RFB, nothing else", () => {
    expect(parseScreenUp({ type: "take" })).toEqual({ type: "take" })
    expect(parseScreenUp({ type: "rfb", data: "AAEC" })).toEqual({ type: "rfb", data: "AAEC" })
    expect(() => parseScreenUp({ type: "take", extra: 1 })).toThrow()
    expect(() => parseScreenUp({ type: "rfb", data: "not base64!" })).toThrow()
    expect(() => parseScreenUp({ type: "rfb", data: "A".repeat(200 * 1024) })).toThrow()
    expect(() => parseScreenUp({ type: "shell" })).toThrow(/unknown/)
    expect(() => parseScreenUp("take")).toThrow()
  })
})
