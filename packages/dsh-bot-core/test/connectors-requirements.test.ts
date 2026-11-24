import { describe, expect, it } from "vitest"
import { connectorTools } from "../src/connector-contract"
import type { BotConnector, ConnectorStatus } from "../src/contract"
import { connectorProblem, createConnectorCatalog } from "../src/host/connectors/catalog"
import { settingsRecordKey } from "../src/host/connectors/domain"
import type { EnvironmentState } from "../src/host/connectors/readiness"
import { brokerSetup, call, settle } from "./connectors-support"

const READY: EnvironmentState = { ready: true, generation: "g1" }
const signal = () => new AbortController().signal

/** A screen that prepares when `gate` lets it, with a status a test sets. */
function screen(log: string[], status: { current: ConnectorStatus }) {
  let gate: Promise<void> = Promise.resolve()
  let release = () => {}
  const connector: BotConnector = {
    id: "screen",
    name: "Screen",
    sessions: "bot",
    minimumSpec: { memoryMiB: 4096 },
    settings: [{ key: "big", kind: "toggle", label: { en: "Big" }, default: false }],
    preparation: {
      async prepare() {
        log.push("prepare screen")
        await gate
      },
    },
    tools: [
      connectorTools().tool({
        name: "look",
        description: "Look.",
        parameters: {},
        permission: "allow",
        preview: () => ({ title: "Look?", fields: [] }),
        execute: async () => ({ text: "seen" }),
      }),
    ],
    status: { read: () => status.current, subscribe: () => () => {} },
  }
  return {
    connector,
    hold() {
      gate = new Promise((resolve) => {
        release = resolve
      })
    },
    release: () => release(),
  }
}

/** A page connector on the screen, with a resident resource. */
function page(log: string[]): BotConnector<{ n: number }> {
  let opened = 0
  const { schemaTool } = connectorTools<{ n: number }>()
  const tool = (name: string, readOnly?: boolean) =>
    schemaTool({
      name,
      description: name,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      permission: "allow",
      ...(readOnly === undefined ? {} : { readOnly }),
      preview: () => ({ title: name, fields: [] }),
      async execute(_args, run) {
        log.push(`${name} on ${run.attachment.n}`)
        return { text: name }
      },
    })
  return {
    id: "page",
    name: "Page",
    sessions: "bot",
    requires: ["screen"],
    preparation: {
      async prepare() {
        log.push("prepare page")
      },
    },
    attachment: {
      async open() {
        opened += 1
        const n = opened
        log.push(`open ${n}`)
        return { value: { n }, dispose: async () => void log.push(`dispose ${n}`) }
      },
    },
    tools: [tool("click"), tool("snapshot", true)],
  }
}

describe("connectors that require others", () => {
  it("wait for, follow and leave with the connectors they require", async () => {
    const setup = brokerSetup({ environment: () => READY })
    const log: string[] = []
    const status = { current: {} as ConnectorStatus }
    const desk = screen(log, status)
    const browser = page(log)
    setup.catalog.register(desk.connector)
    setup.catalog.register(browser)
    desk.hold()
    await setup.enable(desk.connector, ["b1"], { big: false })
    await setup.enable(browser, ["b1"])
    await settle()
    expect(setup.readiness.state("b1", "page")).toMatchObject({
      state: "preparing",
      stage: { kind: "requirements", connectors: ["Screen"] },
    })
    await expect(
      setup.broker.call({ ...call("click", {}), connectorId: "page" }, signal()),
    ).rejects.toThrow(/Page is being prepared for this bot \(waiting for Screen to be ready\)/)
    desk.release()
    await settle()
    expect(setup.readiness.state("b1", "screen").state).toBe("ready")
    expect(setup.readiness.state("b1", "page").state).toBe("ready")
    expect(log).toEqual(["prepare screen", "prepare page"])
    await setup.broker.call({ ...call("click", {}), connectorId: "page" }, signal())
    desk.hold()
    await setup.clock.advance(1_000)
    await setup.settings.configure("b1", desk.connector, { enabled: true, values: { big: true } })
    await settle()
    expect(setup.readiness.state("b1", "page").state).toBe("preparing")
    expect(log).toContain("dispose 1")
    desk.release()
    await settle()
    expect(setup.readiness.state("b1", "page").state).toBe("ready")
    expect(log.filter((line) => line === "prepare page")).toHaveLength(2)
    desk.hold()
    await setup.clock.advance(1_000)
    await setup.settings.configure("b1", desk.connector, { enabled: true, values: { big: false } })
    await settle()
    expect(setup.readiness.state("b1", "page")).toMatchObject({
      state: "preparing",
      stage: { kind: "requirements" },
    })
  })

  it("are turned on only after what they require, which is turned off only after them", async () => {
    const setup = brokerSetup({ environment: () => READY })
    const desk = screen([], { current: {} })
    const browser = page([])
    setup.catalog.register(desk.connector)
    setup.catalog.register(browser)
    await expect(
      setup.settings.configure("b1", browser, { enabled: true, values: {} }),
    ).rejects.toThrow("turn on Screen first: Page needs it")
    expect(setup.settings.view("b1", browser).enabled).toBe(false)
    await setup.enable(desk.connector, ["b1"], { big: false })
    await setup.enable(browser, ["b1"])
    await expect(
      setup.settings.configure("b1", desk.connector, { enabled: false, values: { big: false } }),
    ).rejects.toThrow("turn off Page first: it needs Screen")
    await setup.settings.configure("b1", desk.connector, { enabled: true, values: { big: true } })
    expect(setup.settings.view("b1", desk.connector)).toMatchObject({
      enabled: true,
      values: { big: true },
    })
    await setup.settings.configure("b1", browser, { enabled: false, values: {} })
    await setup.settings.configure("b1", desk.connector, { enabled: false, values: { big: true } })
    expect(setup.settings.view("b1", desk.connector).enabled).toBe(false)
  })

  it("refuse to turn on one whose requirement is not installed", async () => {
    const setup = brokerSetup({ environment: () => READY })
    const browser = page([])
    setup.catalog.register(browser)
    await expect(
      setup.settings.configure("b1", browser, { enabled: true, values: {} }),
    ).rejects.toThrow(
      "Page cannot be turned on: it needs connectors that are not installed (screen)",
    )
  })

  it("stored on while what they require is off wait, and may be turned off or completed", async () => {
    const setup = brokerSetup({ environment: () => READY })
    const desk = screen([], { current: {} })
    const browser = page([])
    setup.catalog.register(desk.connector)
    setup.catalog.register(browser)
    const stored = async () => {
      await setup.settingsRecords.put(settingsRecordKey("b1", "page"), {
        botId: "b1",
        connectorId: "page",
        enabled: true,
        values: {},
        updatedAt: 0,
      })
      setup.readiness.sync("b1")
      await settle()
    }
    await stored()
    expect(setup.readiness.state("b1", "page")).toEqual({
      state: "unavailable",
      cause: "requirements",
      reason: "needs Screen, which is off for this bot: turn it on too",
    })
    await setup.settings.configure("b1", browser, { enabled: true, values: {} })
    await setup.settings.configure("b1", browser, { enabled: false, values: {} })
    expect(setup.readiness.state("b1", "page")).toEqual({ state: "disabled" })
    await stored()
    await setup.settings.configure("b1", desk.connector, { enabled: true, values: { big: false } })
    await settle()
    expect(setup.readiness.state("b1", "screen").state).toBe("ready")
    expect(setup.readiness.state("b1", "page").state).toBe("ready")
  })

  it("run only their reading tools while a person operates what they require", async () => {
    const setup = brokerSetup({ environment: () => READY })
    const log: string[] = []
    const status = { current: {} as ConnectorStatus }
    const desk = screen(log, status)
    const browser = page(log)
    setup.catalog.register(desk.connector)
    setup.catalog.register(browser)
    await setup.enable(desk.connector, ["b1"], { big: false })
    await setup.enable(browser, ["b1"])
    await settle()
    const click = () => setup.broker.call({ ...call("click", {}), connectorId: "page" }, signal())
    const snapshot = () =>
      setup.broker.call({ ...call("snapshot", {}), connectorId: "page" }, signal())
    status.current = { operatedBy: "person" }
    await expect(click()).rejects.toThrow(
      /^USER_IN_CONTROL: a person is operating this bot's Screen, which Page works on, so page_click did not run/,
    )
    await expect(snapshot()).resolves.toMatchObject({ text: "snapshot" })
    status.current = {}
    await expect(click()).resolves.toMatchObject({ text: "click" })
    expect(log.filter((line) => line.includes(" on "))).toEqual(["snapshot on 1", "click on 1"])
  })

  it("are checked when they register", () => {
    const base = page([])
    expect(connectorProblem(base)).toBeUndefined()
    expect(connectorProblem({ ...base, requires: ["page"] })).toMatch(/requires itself/)
    expect(connectorProblem({ ...base, requires: ["screen", "screen"] })).toMatch(/twice/)
    expect(connectorProblem({ ...base, requires: ["Screen"] })).toMatch(/not connector ids/)
    expect(
      connectorProblem({
        ...base,
        tools: [{ ...(base.tools[0] as object), readOnly: "yes" }],
      } as never),
    ).toMatch(/readOnly/)
    const catalog = createConnectorCatalog()
    catalog.register({ ...base, id: "a", requires: ["b"] })
    expect(() =>
      catalog.register({
        ...base,
        id: "b",
        requires: ["a"],
        tools: base.tools.map((tool) => ({ ...tool, name: `b_${tool.name}` })),
      }),
    ).toThrow(/requires a connector that requires it/)
  })
})
