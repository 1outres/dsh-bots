import { describe, expect, it } from "vitest"
import { AgentCallError } from "../src/host/agent/rpc"
import { png } from "./png"
import { execute, fakeAgent, runOf, session, toolsWith, WHERE } from "./support"

const SCREEN = { width: 1280, height: 1024 }
const screenshotAnswer = () => {
  const data = png(1280, 1024)
  return {
    format: "png",
    width: 1280,
    height: 1024,
    bytes: data.byteLength,
    region: [0, 0, 1280, 1024],
    screen: [1280, 1024],
    data: data.toString("base64"),
  }
}

describe("pointer coordinates", () => {
  it("need a screenshot first", async () => {
    const { agent, calls } = fakeAgent({})
    const { byName } = toolsWith()
    await expect(execute(byName("click"), { x: 10, y: 10 }, runOf(session(agent)))).rejects.toThrow(
      /^SCREENSHOT_REQUIRED/,
    )
    expect(calls).toEqual([])
  })

  it("refer to the latest screenshot's image as the model got it", async () => {
    const { agent, calls } = fakeAgent({
      screenshot: screenshotAnswer,
      input: () => ({ pointer: { x: 640, y: 512 }, ...WHERE }),
    })
    const { byName } = toolsWith()
    const desktop = session(agent)
    const run = runOf(desktop, { admit: { width: 1024, height: 819 } })
    const shot = await execute(byName("screenshot"), {}, run)
    expect(shot.images).toHaveLength(1)
    expect(run.admitted[0]?.mediaType).toBe("image/png")
    expect(shot.data).toMatchObject({ width: 1024, height: 819 })
    const click = await execute(byName("click"), { x: 512, y: 409 }, run)
    expect(calls[1]).toEqual({
      method: "input",
      params: {
        kind: "click",
        at: { x: 640, y: 512 },
        button: "left",
        count: 1,
        modifiers: [],
        expect_screen: SCREEN,
      },
    })
    expect(click.data).toMatchObject({
      pointer: { screen: { x: 640, y: 512 }, screenshot: { x: 512, y: 409 } },
    })
  })

  it("take an element instead, without a screenshot", async () => {
    const { agent, calls } = fakeAgent({ input: () => WHERE })
    const { byName } = toolsWith()
    await execute(byName("move"), { element: "3:7" }, runOf(session(agent)))
    expect(calls[0]?.params).toEqual({ kind: "move", at: { element: "3:7" } })
    await expect(
      execute(byName("move"), { element: "3:7", x: 1, y: 2 }, runOf(session(agent))),
    ).rejects.toThrow(/not both/)
    await expect(
      execute(byName("move"), { element: "nope" }, runOf(session(agent))),
    ).rejects.toThrow(/not an element id/)
  })

  it("forget the screenshot when the screen size changed", async () => {
    const { agent } = fakeAgent({
      screenshot: screenshotAnswer,
      input: new AgentCallError("screen_changed", "the screen is 1280x800 now"),
    })
    const { byName } = toolsWith()
    const desktop = session(agent)
    const run = runOf(desktop)
    await execute(byName("screenshot"), {}, run)
    await expect(execute(byName("click"), { x: 5, y: 5 }, run)).rejects.toThrow(
      /^SCREENSHOT_REQUIRED/,
    )
    expect(desktop.frames.current()).toBeUndefined()
  })

  it("zoom a region of the latest screenshot", async () => {
    const { agent, calls } = fakeAgent({ screenshot: screenshotAnswer })
    const { byName } = toolsWith()
    const run = runOf(session(agent))
    await execute(byName("screenshot"), {}, run)
    await execute(
      byName("screenshot"),
      { region: { x: 100, y: 100, width: 200, height: 100 } },
      run,
    )
    expect(calls[1]?.params).toEqual({
      region: { x: 100, y: 100, width: 200, height: 100 },
      width: 800,
      format: "png",
      expect_screen: SCREEN,
    })
  })
})

describe("screenshots", () => {
  it("need a calling model that takes images", async () => {
    const { agent } = fakeAgent({ screenshot: screenshotAnswer })
    const { byName } = toolsWith()
    await expect(
      execute(byName("screenshot"), {}, runOf(session(agent), { caller: false })),
    ).rejects.toThrow(/calling model/)
    await expect(
      execute(
        byName("screenshot"),
        {},
        runOf(session(agent), { admit: "the model takes no images" }),
      ),
    ).rejects.toThrow(/takes no images. Use desktop_tree/)
  })

  it("refuse an image the agent misdescribes", async () => {
    const { agent } = fakeAgent({ screenshot: () => ({ ...screenshotAnswer(), width: 1000 }) })
    const { byName } = toolsWith()
    await expect(execute(byName("screenshot"), {}, runOf(session(agent)))).rejects.toThrow(
      /not the size/,
    )
  })
})

describe("who operates the desktop", () => {
  it("refuses the tools that change the screen while a person does, not the ones that read it", async () => {
    const { agent, calls } = fakeAgent({
      status: () => ({ screen: SCREEN, windows: [], focus: null }),
    })
    const { byName, control } = toolsWith()
    control.take("b1", Symbol("viewer"))
    const run = runOf(session(agent))
    for (const [name, args] of [
      ["type", { text: "x" }],
      ["key", { keys: ["Return"] }],
      ["act", { element: "1:1", action: "press" }],
      ["launch", { app: "calc" }],
      ["sheet", { action: "write", start: "A1", values: [["x"]] }],
    ] as const) {
      await expect(execute(byName(name), args, run)).rejects.toThrow(/^USER_IN_CONTROL/)
    }
    expect(calls).toEqual([])
    expect((await execute(byName("windows"), {}, run)).text).toContain("screen 1280x1024")
  })

  it("says once, after the person handed it back, that the screen may have changed", async () => {
    const { agent } = fakeAgent({ input: () => WHERE })
    const { byName, control } = toolsWith()
    const run = runOf(session(agent))
    const viewer = Symbol("viewer")
    control.take("b1", viewer)
    control.release("b1", viewer, "handed-back")
    const first = await execute(byName("key"), { keys: ["Return"] }, run)
    expect(first.text).toMatch(/a person operated this desktop/)
    const second = await execute(byName("key"), { keys: ["Return"] }, run)
    expect(second.text).toBeUndefined()
  })

  it("says the connection was opened again, from the second connection on", async () => {
    const { agent } = fakeAgent({ input: () => WHERE })
    const { byName, control } = toolsWith()
    control.connected("b1")
    expect(
      (await execute(byName("key"), { keys: ["Tab"] }, runOf(session(agent)))).text,
    ).toBeUndefined()
    control.connected("b1")
    expect((await execute(byName("key"), { keys: ["Tab"] }, runOf(session(agent)))).text).toMatch(
      /opened again/,
    )
  })

  it("keeps each bot's control apart", () => {
    const { control } = toolsWith()
    control.take("b1", Symbol("viewer"))
    expect(control.view("b1").controller).toBe("human")
    expect(control.view("b2").controller).toBe("agent")
  })
})

describe("arguments the schema cannot check", () => {
  it("refuses key names that are not key combinations", async () => {
    const { agent, calls } = fakeAgent({ input: () => WHERE })
    const { byName } = toolsWith()
    await expect(
      execute(byName("key"), { keys: ["ctrl+s; rm -rf /"] }, runOf(session(agent))),
    ).rejects.toThrow(/not a key/)
    await expect(
      execute(byName("hold_key"), { keys: "shift", duration_ms: 60_000 }, runOf(session(agent))),
    ).rejects.toThrow(/from 10 to 10000/)
    expect(calls).toEqual([])
  })

  it("refuses launch options and pairs set_text with text", async () => {
    const { agent } = fakeAgent({})
    const { byName } = toolsWith()
    await expect(
      execute(byName("launch"), { app: "chrome", args: ["--no-sandbox"] }, runOf(session(agent))),
    ).rejects.toThrow(/none starting with -/)
    await expect(
      execute(byName("act"), { element: "1:2", action: "set_text" }, runOf(session(agent))),
    ).rejects.toThrow(/set_text needs text/)
  })

  it("passes the agent's guidance on to the model", async () => {
    const { agent } = fakeAgent({
      act: new AgentCallError(
        "unsupported",
        "use action focus on it, then desktop_key ctrl+a and desktop_type",
      ),
    })
    const { byName } = toolsWith()
    await expect(
      execute(
        byName("act"),
        { element: "1:2", action: "set_text", text: "x" },
        runOf(session(agent)),
      ),
    ).rejects.toThrow(
      "unsupported: use action focus on it, then desktop_key ctrl+a and desktop_type",
    )
  })
})

describe("the tree", () => {
  it("asks for the documented defaults and returns the lines", async () => {
    const { agent, calls } = fakeAgent({
      tree: () => ({
        snapshot: 4,
        nodes: 2,
        ms: 10,
        tree: '[4:1] frame "Calc"\n  [4:2] table "Sheet1"',
      }),
    })
    const { byName } = toolsWith()
    const result = await execute(byName("tree"), {}, runOf(session(agent)))
    expect(calls[0]?.params).toEqual({
      scope: "active",
      format: "text",
      max_nodes: 150,
      max_depth: 12,
      max_text: 80,
      geometry: false,
    })
    expect(result.text).toBe('snapshot 4: 2 elements\n[4:1] frame "Calc"\n  [4:2] table "Sheet1"')
  })

  it("finds with a visit budget of 4000 and 20 results", async () => {
    const { agent, calls } = fakeAgent({
      find: () => ({ snapshot: 5, matches: 0, visited: 9, truncated: false, ms: 1, results: "" }),
    })
    const { byName } = toolsWith()
    await execute(byName("find"), { role: "push button" }, runOf(session(agent)))
    expect(calls[0]?.params).toMatchObject({ limit: 20, visit_budget: 4000, role: "push button" })
  })
})
