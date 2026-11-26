import { describe, expect, it } from "vitest"
import { connectorTools, defineConnectorTool } from "../src/connector-contract"
import type { BotConnector, BotConnectorContext } from "../src/contract"
import { createConnectorsBackend } from "../src/host/connectors/backend"
import { createConnectorEnvironment } from "../src/host/connectors/environment"
import { createExclusiveRuns } from "../src/host/connectors/exclusive"
import type { ImageServices } from "../src/host/connectors/images"
import { createConnectorPanel } from "../src/host/connectors/panel"
import type { EnvironmentState } from "../src/host/connectors/readiness"
import { createConnectorToolSurface } from "../src/host/connectors/tools"
import {
  connectorSettingsProblem,
  connectorSettingValuesOf,
  parseConnectorChange,
} from "../src/shared/connectors"
import { brokerSetup, call, settle } from "./connectors-support"

const signal = () => new AbortController().signal

const FIELDS = [
  {
    key: "mode",
    kind: "choice",
    label: { en: "Mode" },
    default: "a",
    options: [
      { value: "a", label: { en: "A" } },
      { value: "b", label: { en: "B" } },
    ],
  },
  { key: "shots", kind: "toggle", label: { en: "Shots" }, default: false },
  { key: "width", kind: "integer", label: { en: "Width" }, default: 1280, min: 640, max: 3840 },
  {
    key: "home",
    kind: "text",
    label: { en: "Home" },
    default: "",
    maxLength: 100,
    pattern: "https://.*",
  },
] as const

describe("connector settings fields", () => {
  it("are checked, parsed from outside and read over their defaults", () => {
    expect(connectorSettingsProblem(FIELDS)).toBeUndefined()
    expect(connectorSettingsProblem([{ ...FIELDS[0], default: "c" }])).toMatch(
      /not one of its options/,
    )
    expect(connectorSettingsProblem([FIELDS[1], FIELDS[1]])).toMatch(/twice/)
    expect(connectorSettingsProblem([{ ...FIELDS[2], default: 1 }])).toMatch(/from min to max/)
    const values = { mode: "b", shots: true, width: 1920, home: " https://x.y " }
    expect(
      parseConnectorChange({ settings: FIELDS, events: false }, { enabled: true, values }),
    ).toEqual({
      enabled: true,
      values: { ...values, home: "https://x.y" },
    })
    expect(() =>
      parseConnectorChange(
        { settings: FIELDS, events: false },
        { enabled: true, values: { ...values, width: 10 } },
      ),
    ).toThrow(/640/)
    expect(() =>
      parseConnectorChange(
        { settings: FIELDS, events: false },
        { enabled: true, values: { ...values, extra: 1 } },
      ),
    ).toThrow(/not a setting/)
    expect(() =>
      parseConnectorChange(
        { settings: FIELDS, events: false },
        { enabled: true, values: { mode: "a" } },
      ),
    ).toThrow(/missing/)
    expect(connectorSettingValuesOf(FIELDS, { mode: "zzz", width: 2000 })).toEqual({
      mode: "a",
      shots: false,
      width: 2000,
      home: "",
    })
  })
})

function desktopLike(
  log: string[],
  options: { fail?: () => boolean } = {},
): BotConnector<{ n: number }> {
  let opened = 0
  const { tool } = connectorTools<{ n: number }>()
  return {
    id: "screen",
    name: "Screen",
    sessions: "bot",
    settings: [FIELDS[1]],
    minimumSpec: { memoryMiB: 3072 },
    preparation: {
      async prepare(context, progress) {
        progress("installing")
        log.push(`prepare ${context.bot.id} shots=${String(context.settings.shots)}`)
        if (options.fail?.()) throw new Error("apt failed")
      },
      async unprepare(context) {
        log.push(`unprepare ${context.bot.id}`)
      },
    },
    attachment: {
      async open(context) {
        opened += 1
        const n = opened
        log.push(`open ${n} ${context.bot.id}`)
        return {
          value: { n },
          dispose: async () => {
            log.push(`dispose ${n}`)
          },
        }
      },
    },
    tools: [
      tool({
        name: "click",
        description: "Click.",
        parameters: { x: { type: "integer", required: true } },
        permission: "allow",
        exclusive: "display",
        preview: (args) => ({ title: `Click ${args.x}?`, fields: [] }),
        async execute(args, run) {
          log.push(`click ${args.x} on ${run.attachment.n} by ${run.caller?.sessionId}`)
          await settle(2)
          log.push(`clicked ${args.x}`)
          return { text: "dispatched" }
        },
      }),
      tool({
        name: "shot",
        description: "Screenshot.",
        parameters: {},
        permission: "allow",
        preview: () => ({ title: "Screenshot?", fields: [] }),
        async execute(_args, run) {
          const admitted = await run.caller?.images.admit({
            mediaType: "image/png",
            data: new Uint8Array([1]),
          })
          if (admitted === undefined || !admitted.ok) {
            throw new Error(`no image: ${admitted?.ok === false ? admitted.reason : "no caller"}`)
          }
          return {
            data: { width: admitted.image.width, height: admitted.image.height },
            images: [admitted.image],
          }
        },
      }),
    ],
  }
}

const READY: EnvironmentState = { ready: true, generation: "g1" }

function images(take = true): ImageServices {
  return {
    attachments: {
      saveImages: async () => [
        { attachmentId: "att-1", mediaType: "image/png", bytes: 1, width: 2560, height: 1600 },
      ],
      readImageRequest: async () => ({ width: 1280, height: 800 }),
    },
    llm: {
      resolveModelInfo: async () => ({ inputModalities: take ? ["text", "image"] : ["text"] }),
      imageRequestTarget: () => ({ width: 1280, height: 800, maxBytes: 1 }),
    },
  }
}

describe("connector readiness", () => {
  it("is disabled until enabled, unavailable without the environment, preparing, then ready", async () => {
    let environment: EnvironmentState = { ready: false, reason: "the VM is booting" }
    const setup = brokerSetup({ environment: () => environment })
    const log: string[] = []
    const connector = desktopLike(log)
    setup.catalog.register(connector)
    const states: string[] = []
    setup.readiness.subscribe((botId, id) => {
      const state = setup.readiness.state(botId, id).state
      if (botId === "b1" && states.at(-1) !== state) states.push(state)
    })
    expect(setup.readiness.state("b1", "screen")).toEqual({ state: "disabled" })
    await setup.enable(connector, ["b1"], { shots: false })
    expect(setup.readiness.state("b1", "screen")).toEqual({
      state: "unavailable",
      cause: "environment",
      reason: "the VM is booting",
    })
    environment = READY
    setup.readiness.sync("b1")
    await settle()
    expect(setup.readiness.state("b1", "screen").state).toBe("ready")
    expect(log).toEqual(["prepare b1 shots=false"])
    expect(states).toEqual(["unavailable", "preparing", "ready"])
    setup.readiness.sync("b1")
    await settle()
    expect(log).toEqual(["prepare b1 shots=false"])
    environment = { ...READY, generation: "g2" }
    setup.readiness.sync("b1")
    await settle()
    await setup.settings.configure("b1", connector, { enabled: true, values: { shots: true } })
    await settle()
    expect(log).toEqual([
      "prepare b1 shots=false",
      "prepare b1 shots=false",
      "prepare b1 shots=true",
    ])
    await setup.settings.configure("b1", connector, { enabled: false, values: { shots: true } })
    await settle()
    expect(setup.readiness.state("b1", "screen")).toEqual({ state: "disabled" })
    expect(log.at(-1)).toBe("unprepare b1")
  })

  it("reports each stage of a preparation with its own start, the whole since the first", async () => {
    const setup = brokerSetup({ environment: () => READY })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const steps: ((step: string) => void)[] = []
    const connector: BotConnector<{ n: number }> = {
      ...desktopLike([]),
      preparation: {
        async prepare(_context, progress) {
          steps.push(progress)
          await gate
        },
      },
    }
    setup.catalog.register(connector)
    await setup.enable(connector, ["b1"], { shots: false })
    const start = setup.clock.now()
    await settle()
    expect(setup.readiness.state("b1", "screen")).toMatchObject({
      since: start,
      stage: { kind: "running", since: start },
    })
    await setup.clock.advance(5_000)
    steps[0]?.("installing packages (31 missing)")
    steps[0]?.("installing packages (31 missing)")
    expect(setup.readiness.state("b1", "screen")).toEqual({
      state: "preparing",
      since: start,
      stage: { kind: "running", step: "installing packages (31 missing)", since: start + 5_000 },
    })
    release()
    await settle()
    expect(setup.readiness.state("b1", "screen").state).toBe("ready")
  })

  it("retries a failed preparation with backoff, or at once on retry", async () => {
    let failing = true
    const setup = brokerSetup({ environment: () => READY })
    const log: string[] = []
    const connector = desktopLike(log, { fail: () => failing })
    setup.catalog.register(connector)
    await setup.enable(connector, ["b1"])
    await settle()
    expect(setup.readiness.state("b1", "screen")).toMatchObject({
      state: "failed",
      reason: "apt failed",
      retryAt: setup.clock.now() + 5_000,
    })
    await setup.clock.advance(5_000)
    expect(setup.readiness.state("b1", "screen")).toMatchObject({
      state: "failed",
      retryAt: setup.clock.now() + 10_000,
    })
    failing = false
    setup.readiness.retry("b1", "screen")
    await settle()
    expect(setup.readiness.state("b1", "screen").state).toBe("ready")
    expect(log.filter((line) => line.startsWith("prepare"))).toHaveLength(3)
  })
})

describe("connector runs", () => {
  it("refuse calls while not ready, open the resident resource once and dispose it when the connector leaves ready", async () => {
    const setup = brokerSetup({ environment: () => READY, images: images() })
    const log: string[] = []
    const connector = desktopLike(log)
    setup.catalog.register(connector)
    const click = (x: number, botId = "b1") =>
      setup.broker.call(
        { ...call("click", {}, botId), connectorId: "screen", args: { x } },
        signal(),
      )
    await expect(click(1)).rejects.toThrow(/not enabled/)
    await setup.enable(connector, ["b1"])
    await settle()
    const [first, second] = await Promise.all([click(1), click(2)])
    expect(first.text).toBe("dispatched")
    expect(second.text).toBe("dispatched")
    expect(log.filter((line) => !line.startsWith("prepare"))).toEqual([
      "open 1 b1",
      "click 1 on 1 by main-1",
      "clicked 1",
      "click 2 on 1 by main-1",
      "clicked 2",
    ])
    await setup.settings.configure("b1", connector, { enabled: true, values: { shots: true } })
    await settle()
    await click(3)
    expect(log).toContain("dispose 1")
    expect(log).toContain("click 3 on 2 by main-1")
  })

  it("return images admitted for the calling model, never to a model without image input", async () => {
    const withImages = brokerSetup({ environment: () => READY, images: images() })
    const connector = desktopLike([])
    withImages.catalog.register(connector)
    await withImages.enable(connector, ["b1"])
    await settle()
    const shot = { ...call("shot", {}), connectorId: "screen" }
    const reply = await withImages.broker.call(shot, signal())
    expect(reply.data).toEqual({ status: "done", result: { width: 1280, height: 800 } })
    expect(reply.images).toEqual([expect.objectContaining({ attachmentId: "att-1" })])
    const textOnly = brokerSetup({ environment: () => READY, images: images(false) })
    textOnly.catalog.register(desktopLike([]))
    await textOnly.enable(desktopLike([]), ["b1"])
    await settle()
    await expect(textOnly.broker.call(shot, signal())).rejects.toThrow(/does not take images/)
  })

  it("serializes calls of one exclusive key and lets an aborted waiter go", async () => {
    const exclusive = createExclusiveRuns()
    const order: string[] = []
    let release = () => {}
    const first = exclusive.run(
      "k",
      signal(),
      () =>
        new Promise<void>((resolve) => {
          order.push("first")
          release = resolve
        }),
    )
    const aborted = new AbortController()
    const second = exclusive.run("k", aborted.signal, async () => order.push("never"))
    const third = exclusive.run("k", signal(), async () => order.push("third"))
    await settle()
    aborted.abort(new Error("stopped"))
    await expect(second).rejects.toThrow("stopped")
    release()
    await first
    await third
    expect(order).toEqual(["first", "third"])
  })
})

describe("ask with a snapshot", () => {
  it("reads the snapshot when the action is created, previews it and hands it to the approved run", async () => {
    const setup = brokerSetup()
    const seen: unknown[] = []
    const connector: BotConnector = {
      id: "mail",
      name: "Mail",
      sessions: "main",
      tools: [
        defineConnectorTool({
          name: "reply",
          description: "Reply.",
          parameters: { to_message: { type: "string", required: true } },
          permission: "ask",
          ask: { waitMs: 0, ttlMs: 10_000 },
          async snapshot(args, run) {
            seen.push(`snapshot by ${run.caller?.sessionId}`)
            return { subject: `Re: subject of ${args.to_message}` }
          },
          preview: (_args, snapshot) => ({
            title: "Reply?",
            fields: [
              { label: "Subject", value: String((snapshot as { subject: string }).subject) },
            ],
          }),
          async execute(_args, run) {
            seen.push(
              run.trigger.kind === "approval" ? run.trigger.snapshot : undefined,
              run.caller,
            )
            return { data: { sent: true } }
          },
        }),
      ],
    }
    setup.catalog.register(connector)
    await setup.enable(connector, ["b1"])
    const reply = await setup.broker.call(
      { ...call("reply", {}), args: { to_message: "m1" } },
      signal(),
    )
    expect(reply.data).toMatchObject({ status: "awaiting-approval" })
    const [action] = setup.ledger.list("b1")
    expect(action?.snapshot).toEqual({ subject: "Re: subject of m1" })
    expect(action?.preview.fields).toEqual([{ label: "Subject", value: "Re: subject of m1" }])
    await setup.broker.recordDecision({
      botId: "b1",
      actionId: action?.id ?? "",
      decision: "approve",
      origin: { kind: "web" },
    })
    await settle()
    expect(seen).toEqual(["snapshot by main-1", { subject: "Re: subject of m1" }, undefined])
    expect(setup.ledger.list("b1")[0]?.status.state).toBe("succeeded")
  })
})

describe("connector sessions", () => {
  it("shows a bot connector's tools to every session of the bot and a main connector's to its Main only", async () => {
    const setup = brokerSetup({ environment: () => READY })
    const screen = desktopLike([])
    setup.catalog.register(setup.connector)
    setup.catalog.register(screen)
    await setup.enable(setup.connector, ["b1"])
    await setup.enable(screen, ["b1"])
    await settle()
    const exists = (botId: string) => botId === "b1"
    const backend = createConnectorsBackend({
      ...setup,
      surface: createConnectorToolSurface(setup),
      panel: createConnectorPanel({ ...setup, exists }),
      exists,
      caller: (_botId, _token, agentId) => ({
        kind: agentId === "main-1" ? "main" : "bot",
        sessionId: agentId,
      }),
    })
    expect(backend.toolAvailable("b1", "t", "main-1", "mail_echo")).toBe(true)
    expect(backend.toolAvailable("b1", "t", "sub-1", "mail_echo")).toBe(false)
    expect(backend.toolAvailable("b1", "t", "sub-1", "screen_click")).toBe(true)
    expect(backend.toolAvailable("b1", "t", "sub-1", "connector_pending_list")).toBe(false)
    await expect(
      backend.callTool(
        "b1",
        "t",
        { agentId: "sub-1", name: "mail_echo", args: { text: "x" } },
        signal(),
      ),
    ).rejects.toThrow(/Main session/)
    const states = backend.states("b1")
    expect(states.map((view) => [view.connector.id, view.enabled, view.readiness.state])).toEqual([
      ["mail", true, "ready"],
      ["screen", true, "ready"],
    ])
    await expect(
      backend.configure("b1", "screen", { enabled: true, values: { shots: "yes" } }),
    ).rejects.toThrow(/true or false/)
  })
})

describe("connector environment access", () => {
  const fakeSubprocess = (stdout: Uint8Array[], exitCode = 0) => {
    const specs: { argv: readonly string[]; cwd: string; stdin: string }[] = []
    const written: Uint8Array[] = []
    return {
      specs,
      written,
      subprocess: {
        spawn(spec: { argv: readonly string[]; cwd: string; stdio: { stdin: "pipe" | "ignore" } }) {
          specs.push({ argv: spec.argv, cwd: spec.cwd, stdin: spec.stdio.stdin })
          return {
            stdin: {
              write: (chunk: Uint8Array, done: (error?: Error | null) => void) => {
                written.push(chunk)
                done()
              },
              end: (done?: () => void) => done?.(),
              on: () => {},
            },
            stdout: (async function* () {
              yield* stdout
            })(),
            collected: { stderr: { readFrom: () => ({ text: exitCode === 0 ? "" : "boom" }) } },
            done: Promise.resolve({ exitCode, signal: null }),
            terminate() {},
          }
        },
      },
    }
  }
  const environmentOf = (fake: ReturnType<typeof fakeSubprocess> | undefined) =>
    createConnectorEnvironment({
      access: () =>
        fake === undefined ? undefined : { subprocess: fake.subprocess, workspace: "/w" },
      workspace: "/w",
      deadline: () => new AbortController().signal,
    })

  it("runs commands in the workspace with binary output, cut at its limit", async () => {
    const fake = fakeSubprocess([new Uint8Array([137, 80]), new Uint8Array([78, 71, 13])])
    const result = await environmentOf(fake).exec({
      argv: ["maim", "-"],
      timeoutMs: 1000,
      maxOutputBytes: 4,
    })
    expect([...result.stdout]).toEqual([137, 80, 78, 71])
    expect(result.stdoutTruncated).toBe(true)
    expect(fake.specs[0]).toEqual({ argv: ["maim", "-"], cwd: "/w", stdin: "ignore" })
  })

  it("writes and reads files through sh in the environment, and fails while it is not available", async () => {
    const fake = fakeSubprocess([])
    await environmentOf(fake).writeFile("/etc/x.conf", new Uint8Array([65]), { mode: 0o600 })
    expect(fake.specs[0]?.argv.slice(0, 2)).toEqual(["sh", "-c"])
    expect(fake.specs[0]?.argv.slice(-2)).toEqual(["/etc/x.conf", "600"])
    expect(fake.written).toEqual([new Uint8Array([65])])
    const failing = fakeSubprocess([], 1)
    await expect(environmentOf(failing).readFile("/nope", { maxBytes: 10 })).rejects.toThrow(
      /reading \/nope failed \(exit 1\): boom/,
    )
    await expect(
      environmentOf(undefined).exec({ argv: ["true"], timeoutMs: 1, maxOutputBytes: 1 }),
    ).rejects.toThrow(/not available/)
  })
})

describe("connector hooks' context", () => {
  it("carries the bot, its settings and its environment", async () => {
    const setup = brokerSetup()
    const connector = desktopLike([])
    setup.catalog.register(connector)
    await setup.enable(connector, ["b1"], { shots: true })
    const context = setup.runs.context("b1", connector, signal()) as BotConnectorContext
    expect(context.bot).toEqual({ id: "b1", name: "Mia" })
    expect(context.settings).toEqual({ shots: true })
    expect(context.environment.workspace).toBe("/home/bot/workspace")
    expect(setup.runs.context("gone", connector, signal())).toBeUndefined()
  })
})
