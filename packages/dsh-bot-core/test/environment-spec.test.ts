import { describe, expect, it } from "vitest"
import type { BotConnector } from "../src/connector-contract"
import { connectorProblem, createConnectorCatalog } from "../src/host/connectors/catalog"
import type { SettingsRecord } from "../src/host/connectors/domain"
import { environmentNeeds } from "../src/host/connectors/needs"
import { createConnectorSettings } from "../src/host/connectors/settings"
import type { EnvironmentSpecRecord } from "../src/host/environment-spec/domain"
import { createEnvironmentSpecStore } from "../src/host/environment-spec/store"
import { createSaveQueue } from "../src/host/save-queue"
import {
  DEFAULT_BOT_ENVIRONMENT_SPEC,
  environmentCapacityShortfallText,
  environmentSpecProblems,
  initialEnvironmentSpec,
  parseEnvironmentSpec,
} from "../src/shared/environment"
import { memoryTable } from "./channels-support"
import { mailConnector } from "./connectors-support"
import { TEST_CAPACITY } from "./support/environment"

const desk: BotConnector = {
  ...mailConnector(),
  id: "desk",
  name: "Desk",
  sessions: "bot",
  minimumSpec: { memoryMiB: 4096 },
}

function setup() {
  const catalog = createConnectorCatalog()
  catalog.register(desk)
  catalog.register(mailConnector())
  const queue = createSaveQueue()
  const specs = createEnvironmentSpecStore({
    records: memoryTable<EnvironmentSpecRecord>(),
    queue,
    needs: (botId) => environmentNeeds(catalog.list(), (id) => settings.enabled(botId, id)),
    now: () => 1,
  })
  const settings = createConnectorSettings({
    records: memoryTable<SettingsRecord>(),
    catalog,
    queue,
    spec: (botId) => specs.get(botId),
    now: () => 1,
  })
  return { catalog, specs, settings }
}

describe("a bot's environment spec", () => {
  it("is the one a new bot was created with, and what its environment ran with for a bot stored before specs", async () => {
    const { specs } = setup()
    await specs.create("new", DEFAULT_BOT_ENVIRONMENT_SPEC)
    expect(specs.get("new")).toEqual(DEFAULT_BOT_ENVIRONMENT_SPEC)
    await expect(specs.create("new", DEFAULT_BOT_ENVIRONMENT_SPEC)).rejects.toThrow(
      "already has a spec",
    )
    const kept = { cpus: 2, memoryMiB: 3072, diskGiB: 10 }
    await specs.adopt("old", { origin: "inspected", spec: kept })
    await specs.adopt("old", { origin: "inspected", spec: DEFAULT_BOT_ENVIRONMENT_SPEC })
    expect(specs.get("old")).toEqual(kept)
    await specs.adopt("vmless", { origin: "default", spec: DEFAULT_BOT_ENVIRONMENT_SPEC })
    expect(specs.get("vmless")).toEqual(DEFAULT_BOT_ENVIRONMENT_SPEC)
  })

  it("turns a connector on only while the spec gives it its minimum, and lowers no value below what one on needs", async () => {
    const { specs, settings } = setup()
    await specs.adopt("solo", {
      origin: "inspected",
      spec: { cpus: 2, memoryMiB: 3072, diskGiB: 10 },
    })
    await expect(settings.configure("solo", desk, { enabled: true, values: {} })).rejects.toThrow(
      "Desk needs 4 GiB of memory or more: raise it on the bot's VM page first",
    )
    await specs.configure("solo", { cpus: 2, memoryMiB: 4096, diskGiB: 10 }, TEST_CAPACITY)
    await settings.configure("solo", desk, { enabled: true, values: {} })
    await expect(
      specs.configure("solo", { cpus: 2, memoryMiB: 3584, diskGiB: 10 }, TEST_CAPACITY),
    ).rejects.toThrow("Desk needs 4 GiB of memory or more")
    await specs.configure("solo", { cpus: 1, memoryMiB: 4096, diskGiB: 12 }, TEST_CAPACITY)
    await settings.configure("solo", desk, { enabled: false, values: {} })
    await specs.configure("solo", { cpus: 1, memoryMiB: 2048, diskGiB: 12 }, TEST_CAPACITY)
    expect(specs.get("solo")).toEqual({ cpus: 1, memoryMiB: 2048, diskGiB: 12 })
  })

  it("checks the connector switch and the spec in one queue, so neither slips past the other", async () => {
    const { specs, settings } = setup()
    await specs.adopt("b", { origin: "inspected", spec: { cpus: 2, memoryMiB: 4096, diskGiB: 10 } })
    const results = await Promise.allSettled([
      settings.configure("b", desk, { enabled: true, values: {} }),
      specs.configure("b", { cpus: 2, memoryMiB: 2048, diskGiB: 10 }, TEST_CAPACITY),
    ])
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"])
    expect(specs.get("b")?.memoryMiB).toBe(4096)
  })

  it("refuses an unread spec's connector, and a spec change before the spec is read", async () => {
    const { specs, settings } = setup()
    await expect(settings.configure("x", desk, { enabled: true, values: {} })).rejects.toThrow(
      "the bot's VM spec is read once its environment is ready",
    )
    await settings.configure("x", mailConnector(), { enabled: true, values: {} })
    await expect(specs.configure("x", DEFAULT_BOT_ENVIRONMENT_SPEC, TEST_CAPACITY)).rejects.toThrow(
      "not read yet",
    )
  })

  it("checks only the keys that change: the range, its step, and a disk that only grows", () => {
    const current = { cpus: 2, memoryMiB: 3072, diskGiB: 10 }
    expect(environmentSpecProblems(current, current, TEST_CAPACITY, [])).toEqual([])
    const outside = { cpus: 2, memoryMiB: 3072, diskGiB: 100 }
    expect(environmentSpecProblems(outside, outside, TEST_CAPACITY, [])).toEqual([])
    expect(
      environmentSpecProblems(current, { cpus: 9, memoryMiB: 3000, diskGiB: 9 }, TEST_CAPACITY, []),
    ).toEqual([
      { kind: "range", key: "cpus", range: TEST_CAPACITY.cpus },
      { kind: "range", key: "memoryMiB", range: TEST_CAPACITY.memoryMiB },
      { kind: "range", key: "diskGiB", range: TEST_CAPACITY.diskGiB },
    ])
    expect(
      environmentSpecProblems({ ...current, diskGiB: 20 }, current, TEST_CAPACITY, []),
    ).toEqual([{ kind: "shrink", key: "diskGiB", current: 20 }])
  })

  it("starts a new bot at the default within the capacity, never below what its connectors need", () => {
    const roomy = {
      cpus: { min: 1, max: 16, step: 1 },
      memoryMiB: { min: 1024, max: 24576, step: 512 },
      diskGiB: { min: 10, max: 400, step: 1, growOnly: true },
    } as const
    expect(initialEnvironmentSpec(roomy, [])).toEqual({
      ok: true,
      spec: DEFAULT_BOT_ENVIRONMENT_SPEC,
    })
    const small = {
      cpus: { min: 1, max: 2, step: 1 },
      memoryMiB: { min: 1024, max: 4700, step: 512 },
      diskGiB: { min: 10, max: 15, step: 1, growOnly: true },
    } as const
    const desktop = { connector: "Desktop", minimum: { memoryMiB: 4096 } }
    expect(initialEnvironmentSpec(small, [desktop])).toEqual({
      ok: true,
      spec: { cpus: 2, memoryMiB: 4608, diskGiB: 15 },
    })
    const tiny = { ...small, memoryMiB: { min: 1024, max: 3072, step: 512 } }
    expect(initialEnvironmentSpec(tiny, [])).toEqual({
      ok: true,
      spec: { cpus: 2, memoryMiB: 3072, diskGiB: 15 },
    })
    const refused = initialEnvironmentSpec(tiny, [desktop])
    expect(refused).toEqual({
      ok: false,
      shortfalls: [{ key: "memoryMiB", need: 4096, available: 3072, connectors: ["Desktop"] }],
    })
    expect(refused.ok ? [] : refused.shortfalls.map(environmentCapacityShortfallText)).toEqual([
      "Desktop needs 4 GiB of memory, but this Host can give a bot's VM at most 3 GiB",
    ])
    const none = { ...small, memoryMiB: { min: 1024, max: 768, step: 512 } }
    const nothing = initialEnvironmentSpec(none, [])
    expect(nothing).toEqual({
      ok: false,
      shortfalls: [{ key: "memoryMiB", need: 1024, available: 512, connectors: [] }],
    })
    expect(nothing.ok ? [] : nothing.shortfalls.map(environmentCapacityShortfallText)).toEqual([
      "this Host cannot give a bot's VM the 1 GiB of memory it needs at least (at most 512 MiB)",
    ])
  })

  it("reads a spec from outside only with every key a positive integer", () => {
    expect(parseEnvironmentSpec({ cpus: 4, memoryMiB: 6144, diskGiB: 20 })).toEqual(
      DEFAULT_BOT_ENVIRONMENT_SPEC,
    )
    expect(() => parseEnvironmentSpec({ cpus: 4, memoryMiB: 6144 })).toThrow("diskGiB")
    expect(() => parseEnvironmentSpec({ cpus: 1.5, memoryMiB: 6144, diskGiB: 20 })).toThrow("cpus")
    expect(() => parseEnvironmentSpec({ cpus: 0, memoryMiB: 6144, diskGiB: 20 })).toThrow("cpus")
    expect(() => parseEnvironmentSpec(null)).toThrow("object")
  })

  it("accepts a connector's minimumSpec only of known keys and positive integers", () => {
    expect(connectorProblem(desk)).toBeUndefined()
    expect(connectorProblem({ ...desk, minimumSpec: { gpu: 1 } } as never)).toMatch(
      /minimumSpec key "gpu"/,
    )
    expect(connectorProblem({ ...desk, minimumSpec: { memoryMiB: 0 } })).toMatch(/positive integer/)
    expect(connectorProblem({ ...desk, minimumSpec: [] } as never)).toMatch(/not an object/)
  })
})
