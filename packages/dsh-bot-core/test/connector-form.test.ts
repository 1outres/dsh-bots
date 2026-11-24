import { describe, expect, it } from "vitest"
import {
  checkTyped,
  connectorChange,
  connectorsByState,
  switchBlockOf,
  typedOf,
} from "../src/client/connector-form"
import { type ConnectorSettingField, checkConnectorSetting } from "../src/shared/connectors"
import { probeDescriptor, probeView } from "./support/connectors-client"

const field = (key: string): ConnectorSettingField => {
  const found = probeDescriptor.settings.find((item) => item.key === key)
  if (found === undefined) throw new Error(key)
  return found
}

describe("connector settings", () => {
  it("saves one edit over what is stored", () => {
    const view = probeView()
    expect(connectorChange(view, { kind: "enabled", enabled: true })).toEqual({
      enabled: true,
      values: { greeting: "hello", slow: false, depth: 3, mode: "a" },
    })
    expect(connectorChange(view, { kind: "value", key: "depth", value: 7 })).toEqual({
      enabled: false,
      values: { greeting: "hello", slow: false, depth: 7, mode: "a" },
    })
  })

  it("gives the events' delivery exactly for a connector with events", () => {
    const withEvents = {
      ...probeView(),
      connector: {
        ...probeDescriptor,
        events: { kinds: [], delivery: "notify" as const, intervalMs: 1000 },
      },
      events: { delivery: "off" as const, waiting: 0 },
    }
    expect(connectorChange(withEvents, { kind: "enabled", enabled: true }).events).toBe("off")
    expect(connectorChange(withEvents, { kind: "events", delivery: "queue" }).events).toBe("queue")
    expect("events" in connectorChange(probeView(), { kind: "enabled", enabled: true })).toBe(false)
  })

  it("checks typed values as the Host does: integers from their digits, text trimmed", () => {
    expect(checkTyped(field("depth"), " 4 ")).toEqual({ ok: true, value: 4 })
    for (const depth of ["0", "10", "1.5", "2e0", "abc", ""]) {
      expect(checkTyped(field("depth"), depth).ok).toBe(false)
    }
    expect(checkTyped(field("greeting"), " hi ")).toEqual({ ok: true, value: "hi" })
    expect(checkTyped(field("greeting"), "too long")).toEqual({
      ok: false,
      issue: { kind: "length", max: 5 },
    })
    expect(typedOf(3)).toBe("3")
    expect(typedOf(undefined)).toBe("")
  })

  it("shares its checks with the Host's parser", () => {
    const text = {
      key: "code",
      kind: "text",
      label: { en: "Code" },
      maxLength: 8,
      pattern: "[a-z]+",
      default: "",
    } as const
    expect(checkConnectorSetting(text, " abc ")).toEqual({ ok: true, value: "abc" })
    expect(checkConnectorSetting(text, "ABC")).toEqual({ ok: false, issue: { kind: "format" } })
  })

  it("blocks turning on a connector whose minimumSpec the bot's spec does not give, never turning it off", () => {
    const off = probeView()
    const spec = { cpus: 4, memoryMiB: 3072, diskGiB: 20 }
    expect(switchBlockOf(off, [off], spec)).toEqual({ kind: "spec", key: "memoryMiB", need: 4096 })
    expect(switchBlockOf(off, [off], { ...spec, memoryMiB: 4096 })).toBeUndefined()
    expect(switchBlockOf(off, [off], undefined)).toEqual({ kind: "spec-unread" })
    const on = probeView({ enabled: true })
    expect(switchBlockOf(on, [on], spec)).toBeUndefined()
    const light = probeView({ descriptor: { ...probeDescriptor, minimumSpec: {} } })
    expect(switchBlockOf(light, [light], undefined)).toBeUndefined()
  })

  it("splits the connectors into on and off, each in registration order", () => {
    const a = probeView({ enabled: true })
    const b = probeView({ descriptor: { ...probeDescriptor, id: "b" } })
    const c = probeView({ enabled: true, descriptor: { ...probeDescriptor, id: "c" } })
    expect(connectorsByState([a, b, c])).toEqual({ on: [a, c], off: [b] })
  })
})
