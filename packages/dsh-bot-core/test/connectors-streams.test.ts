import { describe, expect, it, vi } from "vitest"
import { connectorStream, defineConnectorTool } from "../src/connector-contract"
import type { BotConnector, BotConnectorStreamRun } from "../src/contract"
import { createConnectorCatalog } from "../src/host/connectors/catalog"
import { createConnectorPanel } from "../src/host/connectors/panel"
import type { ConnectorStreamRequest } from "../src/host/connectors/streams"
import {
  type ConnectorJson,
  type ConnectorStatus,
  MAX_CONNECTOR_STREAMS,
} from "../src/shared/connectors"
import { brokerSetup, settle } from "./connectors-support"

const OWNER = { kind: "owner" }

/** A queue the test pushes uplink items into, as the Gateway delivers them. */
function uplinkQueue() {
  const items: unknown[] = []
  let wake: (() => void) | undefined
  let ended = false
  let returned = false
  const iterable: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]: () => ({
      async next() {
        while (items.length === 0 && !ended) await new Promise<void>((resolve) => (wake = resolve))
        if (items.length > 0) return { done: false, value: items.shift() }
        return { done: true, value: undefined }
      },
      async return() {
        returned = true
        ended = true
        wake?.()
        return { done: true, value: undefined }
      },
    }),
  }
  return {
    iterable,
    push(item: unknown) {
      items.push(item)
      wake?.()
    },
    returned: () => returned,
  }
}

function screenConnector(status: {
  current: ConnectorStatus
  listeners: Set<(botId: string) => void>
}) {
  const seen: unknown[] = []
  const connector: BotConnector = {
    id: "screen",
    name: "Screen",
    sessions: "bot",
    tools: [
      defineConnectorTool({
        name: "look",
        description: "Look.",
        parameters: {},
        permission: "allow",
        preview: () => ({ title: "Look?", fields: [] }),
        execute: async () => ({}),
      }),
    ],
    panel: {
      title: { en: "Screen", ja: "画面" },
      icon: "desktop",
      streams: [
        connectorStream<{ readonly say: string }>({
          name: "view",
          parse(item) {
            if (
              typeof item !== "object" ||
              item === null ||
              typeof (item as { say?: unknown }).say !== "string"
            )
              throw new Error("not a say item")
            return item as { readonly say: string }
          },
          async *open(
            run: BotConnectorStreamRun<{ readonly say: string }>,
          ): AsyncGenerator<ConnectorJson> {
            yield { hello: run.bot.id }
            const aborted = new Promise<void>((resolve) => {
              if (run.signal.aborted) resolve()
              run.signal.addEventListener("abort", () => resolve(), { once: true })
            })
            const iterator = run.uplink[Symbol.asyncIterator]()
            for (;;) {
              const next = await Promise.race([iterator.next(), aborted.then(() => undefined)])
              if (next === undefined || next.done) return
              seen.push(next.value)
              yield { echo: next.value.say }
            }
          },
        }),
      ],
    },
    status: {
      read: () => status.current,
      subscribe(listener) {
        status.listeners.add(listener)
        return () => status.listeners.delete(listener)
      },
    },
  }
  return { connector, seen }
}

async function setup() {
  const broker = brokerSetup()
  const status = { current: {} as ConnectorStatus, listeners: new Set<(botId: string) => void>() }
  const { connector, seen } = screenConnector(status)
  broker.catalog.register(connector)
  await broker.enable(connector, ["b1"])
  await settle()
  const request = (overrides: Partial<ConnectorStreamRequest> = {}) => {
    const uplink = uplinkQueue()
    const abort = new AbortController()
    const stream = broker.streams
      .open({
        caller: OWNER,
        botId: "b1",
        connectorId: "screen",
        stream: "view",
        uplink: uplink.iterable,
        signal: abort.signal,
        ...overrides,
      })
      [Symbol.asyncIterator]()
    return { stream, uplink, abort }
  }
  return { ...broker, connector, seen, status, request }
}

describe("connector panel streams", () => {
  it("serve the owner while the connector is ready, with the uplink parsed", async () => {
    const { request, seen } = await setup()
    const { stream, uplink } = request()
    expect(await stream.next()).toEqual({ done: false, value: { hello: "b1" } })
    uplink.push({ say: "hi" })
    expect(await stream.next()).toEqual({ done: false, value: { echo: "hi" } })
    expect(seen).toEqual([{ say: "hi" }])
    await stream.return?.()
    expect(uplink.returned()).toBe(true)
  })

  it("refuse anyone but the owner, unknown bots, connectors and streams, and a connector not ready", async () => {
    const { request, settings, connector } = await setup()
    const refusal = async (overrides: Partial<ConnectorStreamRequest>) => {
      const { stream } = request(overrides)
      return stream.next().then(
        () => "opened",
        (error: Error) => error.message,
      )
    }
    expect(await refusal({ caller: { kind: "liveshare" } })).toMatch(/only the owner/)
    expect(await refusal({ caller: undefined })).toMatch(/only the owner/)
    expect(await refusal({ botId: "nobody" })).toMatch(/does not exist/)
    expect(await refusal({ connectorId: "mail" })).toMatch(/not registered/)
    expect(await refusal({ stream: "other" })).toMatch(/no stream "other"/)
    expect(await refusal({ botId: "b2" })).toMatch(/not ready/)
    await settings.configure("b1", connector, { enabled: false, values: {} })
    await settle()
    expect(await refusal({})).toMatch(/not ready/)
  })

  it("fails a stream whose browser sends an item its parse refuses", async () => {
    const { request, streams } = await setup()
    const { stream, uplink } = request()
    await stream.next()
    uplink.push({ nonsense: 1 })
    await expect(stream.next()).rejects.toThrow("not a say item")
    expect(streams.count("b1", "screen")).toBe(0)
  })

  it("end once the connector leaves ready for the bot, and when the viewer leaves", async () => {
    const { request, settings, connector, streams } = await setup()
    const first = request()
    const second = request()
    await first.stream.next()
    await second.stream.next()
    expect(streams.count("b1", "screen")).toBe(2)
    second.abort.abort()
    expect(await second.stream.next()).toEqual({ done: true, value: undefined })
    await settings.configure("b1", connector, { enabled: false, values: {} })
    await settle()
    expect(await first.stream.next()).toEqual({ done: true, value: undefined })
    expect(streams.count("b1", "screen")).toBe(0)
    expect(first.uplink.returned()).toBe(true)
  })

  it("allow at most MAX_CONNECTOR_STREAMS at once per bot and connector", async () => {
    const { request } = await setup()
    const open = []
    for (let i = 0; i < MAX_CONNECTOR_STREAMS; i += 1) {
      const opened = request()
      await opened.stream.next()
      open.push(opened)
    }
    await expect(request().stream.next()).rejects.toThrow(/already has/)
    await open[0]?.stream.return?.()
    await expect(request().stream.next()).resolves.toMatchObject({ done: false })
  })
})

describe("connector status and panel in views", () => {
  it("shows the panel and the status of an enabled connector, and follows its changes", async () => {
    const broker = await setup()
    const panel = createConnectorPanel({ ...broker, exists: (botId) => botId !== "nobody" })
    const heard = vi.fn()
    panel.subscribe(heard)
    const view = () => panel.views("b1").find((entry) => entry.connector.id === "screen")
    expect(view()?.connector.panel).toEqual({
      title: { en: "Screen", ja: "画面" },
      icon: "desktop",
      streams: ["view"],
    })
    expect(view()?.status).toEqual({})
    broker.status.current = { request: { id: "r1", reason: "log in", since: 5 } }
    for (const listener of broker.status.listeners) listener("b1")
    expect(heard).toHaveBeenCalled()
    expect(view()?.status).toEqual({ request: { id: "r1", reason: "log in", since: 5 } })
    expect(panel.views("b2").find((entry) => entry.connector.id === "screen")?.status).toEqual({})
    broker.statuses.dispose()
    expect(broker.status.listeners.size).toBe(0)
  })

  it("refuses a panel without a title, a stream named twice or one without open", () => {
    const status = { current: {}, listeners: new Set<(botId: string) => void>() }
    const { connector } = screenConnector(status)
    const stream = connector.panel?.streams[0]
    if (stream === undefined) throw new Error("no stream")
    const catalog = createConnectorCatalog()
    const register = (patch: Partial<BotConnector>) => () =>
      catalog.register({ ...connector, ...patch })
    const panel = (patch: Partial<NonNullable<BotConnector["panel"]>>) =>
      register({ panel: { title: { en: "S" }, icon: "desktop", streams: [], ...patch } })
    expect(panel({ title: { en: "" } })).toThrow(/English title/)
    expect(
      panel({ icon: "rocket" as unknown as NonNullable<BotConnector["panel"]>["icon"] }),
    ).toThrow(/icon is not one of/)
    expect(panel({ streams: [stream, stream] })).toThrow(/twice/)
    expect(panel({ streams: [{ ...stream, name: "Bad name" }] })).toThrow(/stream whose name/)
    expect(register({ status: { read: () => ({}) } as unknown as BotConnector["status"] })).toThrow(
      /status without/,
    )
  })
})
