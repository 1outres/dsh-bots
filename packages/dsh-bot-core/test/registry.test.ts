import { describe, expect, it } from "vitest"
import type { CatalogConnector } from "../src/host/connectors/catalog"
import type { BotRecord, BotSessionRecord } from "../src/host/domain"
import { type BotTable, createBotRegistry } from "../src/host/registry"
import type { BotEnvironmentSpec } from "../src/shared/environment"
import { DEFAULT_BOT_MODELS } from "../src/shared/models"

function memoryTable<V>(rows = new Map<string, V>()): BotTable<V> {
  return {
    get: (key) => rows.get(key),
    entries: () => rows.entries(),
    put: async (key, value) => {
      rows.set(key, value)
    },
    delete: async (key) => rows.delete(key),
  }
}

function registry(
  options: {
    failMain?: boolean | ((id: string) => boolean)
    failRename?: boolean
    refuse?: boolean
    failEnable?: boolean
    noWorkstation?: boolean
    failSpec?: boolean
    rows?: Map<string, BotRecord>
    sessions?: Map<string, BotSessionRecord>
  } = {},
) {
  let id = 0
  let session = 0
  let clock = 1000
  const mainIds: string[] = []
  const renamed: [string, string][] = []
  const warnings: string[] = []
  /** Main sessions opened, and the bot whose Main each was by then. */
  const opened: { sessionId: string; main: string | undefined }[] = []
  /** Connectors enabled per bot, and whether the bot was announced when they were. */
  const enabled: { botId: string; ids: string[]; announced: boolean }[] = []
  let announced = new Set<string>()
  const initialFor: { botId: string; connectors: string[] }[] = []
  const storedSpecs: { botId: string; spec: BotEnvironmentSpec }[] = []
  const rows = options.rows ?? new Map<string, BotRecord>()
  const sessions = options.sessions ?? new Map<string, BotSessionRecord>()
  const bots = createBotRegistry({
    table: memoryTable(rows),
    sessions: memoryTable(sessions),
    admit: () => {
      if (options.refuse === true) throw new Error("no environment")
    },
    connectors: {
      select(input) {
        if (!(input as { workstation: boolean }).workstation) return []
        if (options.noWorkstation === true) {
          throw new Error("no registered connector offers the workstation option")
        }
        return ["desktop", "browser"].map((id) => ({ id }) as unknown as CatalogConnector)
      },
      async enable(botId, connectors) {
        if (options.failEnable === true) throw new Error("storage refused")
        enabled.push({
          botId,
          ids: connectors.map((connector) => connector.id),
          announced: announced.has(botId),
        })
      },
    },
    specs: {
      initial: async (botId, connectors) => {
        initialFor.push({ botId, connectors: connectors.map((connector) => connector.id) })
        if (options.failSpec === true) throw new Error("this Host cannot give a bot's VM 1 GiB")
        return { cpus: 2, memoryMiB: 2048, diskGiB: 10 }
      },
      create: async (botId, spec) => {
        storedSpecs.push({ botId, spec })
      },
      discard: async () => {},
    },
    models: {
      initial: async () => DEFAULT_BOT_MODELS,
      store: async () => {},
      discard: async () => {},
    },
    // Like Bot.createSession: the session is recorded as the bot's before it resolves.
    startMain: async (bot) => {
      const fail =
        typeof options.failMain === "function" ? options.failMain(bot.id) : options.failMain
      const sessionId = `s${++session}`
      await bots.adopt(bot.id, sessionId)
      if (fail === true) throw new Error("no session")
      mainIds.push(bot.id)
      return sessionId
    },
    openMain: (bot) => {
      opened.push({ sessionId: bot.mainSessionId, main: bots.botOfMain(bot.mainSessionId)?.id })
    },
    canonicalTimezone: (value) => {
      if (value !== "UTC" && value !== "Europe/Paris" && value !== "Asia/Tokyo") {
        throw new Error(`unknown zone ${String(value)}`)
      }
      return value
    },
    renameMain: async (sessionId, name) => {
      if (options.failRename) throw new Error("not live")
      renamed.push([sessionId, name])
    },
    warn: (message) => warnings.push(message),
    newId: () => `b${++id}`,
    now: () => ++clock,
  })
  bots.subscribe(() => {
    announced = new Set([
      ...bots.creating().map((bot) => bot.id),
      ...bots.list().map((bot) => bot.id),
    ])
  })
  return {
    bots,
    rows,
    sessions,
    mainIds,
    opened,
    renamed,
    warnings,
    enabled,
    initialFor,
    storedSpecs,
  }
}

/** Store a bot and start its Main, as the preset subscription does once it is ready. */
async function created(bots: ReturnType<typeof registry>["bots"], name = "Alpha") {
  const id = await bots.create({
    name,
    avatar,
    workstation: false,
    language: "en",
    timezone: "Asia/Tokyo",
  })
  await bots.repairMains([id])
  const view = bots.get(id)
  if (view === undefined) throw new Error("not created")
  return view
}

const ignore = () => {}

const avatar = { kind: "emoji", emoji: "🤖", color: "#6366F1" } as const

describe("bot registry", () => {
  it("stores a new bot unlisted, then lists it once its Main started, recorded as its own", async () => {
    const { bots, rows, sessions, opened } = registry()
    let changes = 0
    bots.subscribe(() => changes++)
    await expect(
      bots.create({
        name: "  Alpha ",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      }),
    ).resolves.toBe("b1")
    expect(rows.get("b1")).toMatchObject({ name: "Alpha" })
    expect(rows.get("b1")?.mainSessionId).toBeUndefined()
    expect(rows.get("b1")).not.toHaveProperty("path")
    expect(bots.list()).toEqual([])
    expect(bots.creating()).toEqual([
      { id: "b1", name: "Alpha", avatar, createdAt: 1001, sessionIds: [], startingMain: false },
    ])
    expect(changes).toBe(1)
    await bots.repairMains(["b1"])
    expect(bots.get("b1")).toEqual({
      id: "b1",
      name: "Alpha",
      avatar,
      mainSessionId: "s1",
      mainStartedAt: 1002,
      sessionIds: [],
      formerMainIds: [],
      timezone: "Asia/Tokyo",
      language: "en",
      createdAt: 1001,
    })
    expect(opened).toEqual([{ sessionId: "s1", main: "b1" }])
    expect(bots.creating()).toEqual([])
    expect(sessions.get("s1")).toMatchObject({ botId: "b1" })
    expect(bots.botOfMain("s1")?.id).toBe("b1")
    expect(bots.botOfMain("s2")).toBeUndefined()
    expect(bots.botOfSession("s1")).toBe("b1")
    expect(rows.get("b1")?.mainOnBotPreset).toBe(true)
  })

  it("enables the connectors of a new bot's creation options before it is announced", async () => {
    const { bots, enabled } = registry()
    const id = await bots.create({
      name: "Desk",
      avatar,
      workstation: true,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    expect(enabled).toEqual([{ botId: id, ids: ["desktop", "browser"], announced: false }])
    expect(bots.creating().map((bot) => bot.id)).toEqual([id])
    await bots.create({
      name: "Plain",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    expect(enabled.at(-1)).toMatchObject({ ids: [] })
  })

  it("stores the zone the creation names and the spec made for its connectors from the environment", async () => {
    const { bots, rows, initialFor, storedSpecs } = registry()
    const id = await bots.create({
      name: "Desk",
      avatar,
      workstation: true,
      language: "en",
      timezone: "Europe/Paris",
    })
    expect(rows.get(id)?.timezone).toBe("Europe/Paris")
    expect(initialFor).toEqual([{ botId: id, connectors: ["desktop", "browser"] }])
    expect(storedSpecs).toEqual([{ botId: id, spec: { cpus: 2, memoryMiB: 2048, diskGiB: 10 } }])
  })

  it("refuses a creation without a usable zone, or that the environment cannot give a VM, storing nothing", async () => {
    const { bots, rows } = registry()
    await expect(
      bots.create({ name: "A", avatar, workstation: false, language: "en", timezone: "Mars/Base" }),
    ).rejects.toThrow("unknown zone Mars/Base")
    await expect(
      bots.create({ name: "A", avatar, workstation: false, language: "en" } as never),
    ).rejects.toThrow("unknown zone undefined")
    const short = registry({ failSpec: true })
    await expect(
      short.bots.create({
        name: "A",
        avatar,
        workstation: false,
        language: "en",
        timezone: "UTC",
      }),
    ).rejects.toThrow("cannot give a bot's VM")
    expect(rows.size).toBe(0)
    expect(short.rows.size).toBe(0)
    expect(short.storedSpecs).toEqual([])
  })

  it("refuses an option no connector offers before storing anything", async () => {
    const { bots, rows, enabled } = registry({ noWorkstation: true })
    await expect(
      bots.create({
        name: "Desk",
        avatar,
        workstation: true,
        language: "en",
        timezone: "Asia/Tokyo",
      }),
    ).rejects.toThrow("no registered connector offers the workstation option")
    expect(rows.size).toBe(0)
    expect(enabled).toEqual([])
  })

  it("stores nothing when the connectors cannot be enabled", async () => {
    const { bots, rows } = registry({ failEnable: true })
    let changes = 0
    bots.subscribe(() => changes++)
    await expect(
      bots.create({
        name: "Desk",
        avatar,
        workstation: true,
        language: "en",
        timezone: "Asia/Tokyo",
      }),
    ).rejects.toThrow("storage refused")
    expect(rows.size).toBe(0)
    expect(changes).toBe(0)
  })

  it("reports that a Main is starting, with the sessions recorded meanwhile", async () => {
    const { bots } = registry()
    const id = await bots.create({
      name: "Beta",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    const seen: unknown[] = []
    bots.subscribe(() => seen.push(bots.creating()[0]))
    await bots.repairMains([id])
    expect(seen[0]).toMatchObject({ id, startingMain: true, sessionIds: [] })
    expect(seen[1]).toMatchObject({ id, startingMain: true, sessionIds: ["s1"] })
    expect(seen.at(-1)).toBeUndefined()
  })

  it("records sessions of a stored bot once, oldest first, and lists them besides Main", async () => {
    const { bots } = registry()
    const bot = await created(bots)
    let changes = 0
    bots.subscribe(() => changes++)
    await expect(bots.adopt(bot.id, "x1")).resolves.toBe(true)
    await expect(bots.adopt(bot.id, "x1")).resolves.toBe(false)
    await expect(bots.adopt(bot.id, "x2")).resolves.toBe(true)
    // Another bot's session, or a bot that is not stored: not recorded.
    await expect(bots.adopt("zz", "x3")).resolves.toBe(false)
    expect(bots.get(bot.id)?.sessionIds).toEqual(["x1", "x2"])
    expect(bots.sessionsOf(bot.id)).toEqual(["s1", "x1", "x2"])
    expect(bots.botOfSession("x2")).toBe(bot.id)
    expect(bots.botOfSession("x3")).toBeUndefined()
    expect(changes).toBe(2)
  })

  it("sees a session at once while its record is written", async () => {
    const { bots } = registry()
    const bot = await created(bots)
    const adopting = bots.adopt(bot.id, "x1")
    expect(bots.botOfSession("x1")).toBe(bot.id)
    await expect(bots.adopt(bot.id, "x1")).resolves.toBe(false)
    await adopting
  })

  it("stores a template choice and an overlay", async () => {
    const { bots, rows } = registry()
    const bot = await created(bots)
    let changes = 0
    bots.subscribe(() => changes++)
    const ok = () => {}
    await bots.setPreset(bot.id, { template: "helper" }, ok)
    await bots.setPreset(bot.id, { overlay: [{ op: "remove", id: "tool-web" }] }, ok)
    expect(rows.get(bot.id)).toMatchObject({
      template: "helper",
      overlay: [{ op: "remove", id: "tool-web" }],
      mainOnBotPreset: true,
    })
    expect(changes).toBe(2)
    await expect(bots.setPreset("zz", {}, ok)).rejects.toThrow("does not exist")
  })

  it("validates the merged record in the write queue: concurrent changes are checked together", async () => {
    const { bots, rows } = registry()
    const bot = await created(bots)
    const seen: { template?: string; overlay?: unknown }[] = []
    // Only template "helper" without an overlay, or "default" with one, compose.
    const validate = (merged: BotRecord) => {
      seen.push({ template: merged.template, overlay: merged.overlay })
      if (merged.template === "helper" && merged.overlay !== undefined) throw new Error("no fit")
    }
    const both = await Promise.allSettled([
      bots.setPreset(bot.id, { template: "helper" }, validate),
      bots.setPreset(bot.id, { overlay: [{ op: "remove", id: "x" }] }, validate),
    ])
    expect(both.map((result) => result.status)).toEqual(["fulfilled", "rejected"])
    expect(seen[1]).toEqual({ template: "helper", overlay: [{ op: "remove", id: "x" }] })
    expect(rows.get(bot.id)).toMatchObject({ template: "helper" })
    expect(rows.get(bot.id)?.overlay).toBeUndefined()
  })

  it("keeps a bot whose Main could not start, its failure stored, until the creation is retried", async () => {
    let fail = true
    const { bots, rows, warnings, mainIds } = registry({ failMain: () => fail })
    const id = await bots.create({
      name: "Alpha",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    await bots.repairMains([id])
    expect(bots.list()).toEqual([])
    expect(rows.get(id)?.creationFailure).toEqual({
      phase: "starting-main",
      message: "no session",
      at: expect.any(Number),
    })
    expect(bots.creating()[0]).toMatchObject({
      id,
      sessionIds: ["s1"],
      startingMain: false,
      failure: { phase: "starting-main", message: "no session" },
    })
    expect(warnings).toEqual([expect.stringContaining("no session")])
    // Held: no repair starts it again.
    fail = false
    await bots.repairMains()
    expect(mainIds).toEqual([])
    await bots.retryCreation(id)
    expect(rows.get(id)).not.toHaveProperty("creationFailure")
    await bots.repairMains([id])
    expect(bots.get(id)?.mainSessionId).toBe("s2")
  })

  it("stores the first failure of a creation only, and none for a listed bot", async () => {
    const { bots, rows } = registry()
    const id = await bots.create({
      name: "Alpha",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    await expect(
      bots.failCreation(id, { phase: "booting", message: "no vsock", at: 5 }),
    ).resolves.toBe(true)
    await expect(bots.failCreation(id, { phase: "preset", message: "later", at: 6 })).resolves.toBe(
      false,
    )
    expect(rows.get(id)?.creationFailure).toEqual({ phase: "booting", message: "no vsock", at: 5 })
    await expect(bots.failCreation("zz", { phase: "queued", message: "x", at: 1 })).resolves.toBe(
      false,
    )
    const listed = await created(bots, "Beta")
    await expect(
      bots.failCreation(listed.id, { phase: "queued", message: "x", at: 1 }),
    ).resolves.toBe(false)
    await expect(bots.retryCreation(listed.id)).rejects.toThrow("has not failed")
    await expect(bots.retryCreation("zz")).rejects.toThrow("does not exist")
  })

  it("starts one Main when repairs overlap", async () => {
    const { bots, mainIds } = registry()
    const id = await bots.create({
      name: "Alpha",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    await Promise.all([bots.repairMains([id]), bots.repairMains()])
    expect(mainIds).toEqual([id])
  })

  it("refuses to create a bot it could not run, storing nothing", async () => {
    const { bots, rows } = registry({ refuse: true })
    await expect(
      bots.create({
        name: "Alpha",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      }),
    ).rejects.toThrow("no environment")
    expect(rows.size).toBe(0)
  })

  it("repairs only the bots asked for", async () => {
    const record = (name: string): BotRecord => ({ name, avatar, createdAt: 1, updatedAt: 1 })
    const rows = new Map<string, BotRecord>([
      ["x", record("x")],
      ["y", record("y")],
    ])
    const { bots, mainIds } = registry({ rows })
    await bots.repairMains(["y"])
    expect(mainIds).toEqual(["y"])
  })

  it("gives bots stored without a time zone the Host's, and changes a bot's zone", async () => {
    const rows = new Map<string, BotRecord>([
      ["old", { name: "Old", avatar, mainSessionId: "m", createdAt: 1, updatedAt: 1 }],
    ])
    const { bots } = registry({ rows })
    expect(() => bots.timezoneOf("old")).toThrow("no time zone")
    await bots.migrateTimezones(() => "Asia/Tokyo")
    expect(bots.timezoneOf("old")).toBe("Asia/Tokyo")
    expect(bots.get("old")?.timezone).toBe("Asia/Tokyo")
    await expect(bots.update("old", { timezone: "Mars/Base" })).rejects.toThrow("unknown zone")
    await expect(bots.update("old", { timezone: "Europe/Paris" })).resolves.toMatchObject({
      timezone: "Europe/Paris",
    })
    expect(() => bots.timezoneOf("gone")).toThrow("does not exist")
  })

  it("rejects an empty name and a malformed avatar", async () => {
    const { bots } = registry()
    await expect(
      bots.create({
        name: " ",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      }),
    ).rejects.toThrow("name")
    await expect(
      bots.create({
        name: "x",
        avatar: { kind: "image", dataUrl: "http://x" },
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      }),
    ).rejects.toThrow("avatar")
  })

  it("gives stored bots without a Main session one", async () => {
    const rows = new Map<string, BotRecord>([
      ["old", { name: "Old", avatar, timezone: "UTC", createdAt: 1, updatedAt: 1 }],
    ])
    const { bots, mainIds } = registry({ rows })
    expect(bots.list()).toEqual([])
    await bots.repairMains()
    expect(mainIds).toEqual(["old"])
    expect(bots.get("old")?.mainSessionId).toBe("s1")
    expect(rows.get("old")?.mainOnBotPreset).toBe(true)
  })

  it("repairs each bot on its own: one failure does not stop the others", async () => {
    const record = (name: string): BotRecord => ({ name, avatar, createdAt: 1, updatedAt: 1 })
    const rows = new Map<string, BotRecord>([
      ["x", record("x")],
      ["y", record("y")],
    ])
    const { bots, mainIds } = registry({ rows, failMain: (id) => id === "x" })
    await bots.repairMains()
    expect(mainIds).toEqual(["y"])
    expect(rows.get("x")?.mainSessionId).toBeUndefined()
    expect(rows.get("x")?.creationFailure?.phase).toBe("starting-main")
    expect(rows.get("y")?.mainSessionId).toBe("s2")
  })

  it("notifies subscribers and removes bots", async () => {
    const { bots } = registry()
    let changes = 0
    bots.subscribe(() => changes++)
    const bot = await created(bots)
    await bots.update(bot.id, { name: "Beta" })
    await bots.remove(bot.id, "listed", ignore)
    // Creation publishes four times: stored, its Main starting, recorded, then stored with it.
    expect(changes).toBe(6)
    expect(bots.list()).toEqual([])
  })

  it("retitles the Main session only when the name changes", async () => {
    const { bots, renamed } = registry()
    const bot = await created(bots)
    await bots.update(bot.id, { name: "Alpha" })
    await bots.update(bot.id, { avatar: { ...avatar, emoji: "🐱" } })
    await bots.update(bot.id, { name: " Beta " })
    expect(renamed).toEqual([["s1", "Beta"]])
  })

  it("keeps a rename whose Main title could not change, with a warning", async () => {
    const { bots, warnings } = registry({ failRename: true })
    const bot = await created(bots)
    await expect(bots.update(bot.id, { name: "Beta" })).resolves.toMatchObject({ name: "Beta" })
    expect(bots.get(bot.id)?.name).toBe("Beta")
    expect(warnings).toHaveLength(1)
  })

  it("hands over what a removed record leaves before telling subscribers, and keeps its sessions its own", async () => {
    const { bots, rows, sessions } = registry()
    const bot = await created(bots)
    await bots.adopt(bot.id, "x1")
    const order: string[] = []
    bots.subscribe(() => order.push(`published stored=${rows.has(bot.id)}`))
    await bots.remove(bot.id, "listed", (removed) => {
      order.push(`removed stored=${rows.has(bot.id)}`)
      expect(removed).toEqual({
        id: bot.id,
        name: "Alpha",
        avatar,
        createdAt: bot.createdAt,
        mainSessionId: "s1",
        sessionIds: ["s1", "x1"],
        workspaceId: undefined,
      })
    })
    expect(order).toEqual(["removed stored=false", "published stored=false"])
    expect(sessions.size).toBe(2)
    expect(bots.botOfSession("x1")).toBe(bot.id)
    await bots.forget(["s1", "x1"])
    expect(sessions.size).toBe(0)
    expect(bots.botOfSession("x1")).toBe(bot.id)
    await expect(bots.remove(bot.id, "listed", ignore)).rejects.toThrow("does not exist")
  })

  it("removes a listed bot only as listed, and a creation only as one", async () => {
    const { bots, rows } = registry()
    const id = await bots.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    const listed = await created(bots, "Old")
    await expect(bots.remove(id, "listed", ignore)).rejects.toThrow("discard")
    await expect(bots.remove(listed.id, "creating", ignore)).rejects.toThrow("delete it instead")
    expect(rows.size).toBe(2)
    await bots.remove(id, "creating", ignore)
    expect(rows.has(id)).toBe(false)
  })

  it("forgets every session it can, and reports the others together", async () => {
    const sessions = new Map<string, BotSessionRecord>()
    const { bots } = registry({ sessions })
    const bot = await created(bots)
    await bots.adopt(bot.id, "x1")
    await bots.adopt(bot.id, "x2")
    const real = sessions.delete.bind(sessions)
    sessions.delete = (key) => {
      if (key === "s1" || key === "x1") throw new Error(`disk full ${key}`)
      return real(key)
    }
    const forgetting = bots.forget(["s1", "x1", "x2"])
    await expect(forgetting).rejects.toBeInstanceOf(AggregateError)
    await expect(forgetting).rejects.toThrow(/2 of 3 sessions.*disk full s1.*disk full x1/)
    expect([...sessions.keys()]).toEqual(["s1", "x1"])
  })

  it("migrates a version 1 bot: records its Workspace's sessions, retires the Workspace, drops the Host fields", async () => {
    const rows = new Map<string, BotRecord>([
      [
        "old",
        {
          name: "Old",
          avatar,
          path: "/home/u/.dsh/bots/old",
          workspaceId: "ws-old",
          mainSessionId: "m",
          mainOnBotPreset: true,
          timezone: "UTC",
          createdAt: 10,
          updatedAt: 10,
        },
      ],
    ])
    const { bots, sessions } = registry({ rows })
    const retired: string[] = []
    await bots.migrateLegacy(
      (id) => (id === "ws-old" ? ["m", "a", "b"] : undefined),
      async (id) => {
        retired.push(id)
      },
    )
    expect(retired).toEqual(["ws-old"])
    expect(rows.get("old")).not.toHaveProperty("path")
    expect(rows.get("old")).not.toHaveProperty("workspaceId")
    expect([...sessions.keys()]).toEqual(["m", "a", "b"])
    expect(bots.get("old")?.sessionIds).toEqual(["a", "b"])
    // Nothing left to migrate.
    await bots.migrateLegacy(
      () => [],
      async (id) => {
        retired.push(id)
      },
    )
    expect(retired).toEqual(["ws-old"])
  })

  it("keeps a legacy Workspace id when it could not be retired, to try again", async () => {
    const legacy: BotRecord = {
      name: "Old",
      avatar,
      path: "/p",
      workspaceId: "ws-old",
      mainSessionId: "m",
      createdAt: 10,
      updatedAt: 10,
    }
    const rows = new Map<string, BotRecord>([["old", legacy]])
    const { bots, sessions, warnings } = registry({ rows })
    await bots.migrateLegacy(
      () => ["m"],
      async () => {
        throw new Error("busy")
      },
    )
    expect(rows.get("old")?.workspaceId).toBe("ws-old")
    expect(sessions.has("m")).toBe(true)
    expect(warnings).toEqual([expect.stringContaining("tried again")])
  })
})

describe("bot registry: language and initial workspace files", () => {
  it("keeps the language given at creation, changes it on update and refuses one that is no language tag", async () => {
    const { bots, rows } = registry()
    await expect(
      bots.create({
        name: "x",
        avatar,
        workstation: false,
        language: "not a tag",
        timezone: "Asia/Tokyo",
      }),
    ).rejects.toThrow("language")
    const id = await bots.create({
      name: "Alpha",
      avatar,
      workstation: false,
      language: "ja",
      timezone: "Asia/Tokyo",
    })
    expect(rows.get(id)?.language).toBe("ja")
    await bots.repairMains([id])
    expect(bots.get(id)?.language).toBe("ja")
    await expect(bots.update(id, { language: "fr" })).resolves.toMatchObject({ language: "fr" })
    await expect(bots.update(id, { language: "" })).rejects.toThrow("language")
  })

  it("lists a bot stored without a language as having none", async () => {
    const rows = new Map<string, BotRecord>([
      [
        "old",
        {
          name: "Old",
          avatar,
          mainSessionId: "m",
          timezone: "UTC",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ])
    const { bots } = registry({ rows })
    expect(bots.get("old")).not.toHaveProperty("language")
  })

  it("records once the initial workspace files of a version were placed", async () => {
    const { bots, rows } = registry()
    const id = await bots.create({
      name: "Alpha",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    expect(bots.hasWorkspaceFiles(id, 1)).toBe(false)
    await bots.markWorkspaceFiles(id, 1)
    expect(bots.hasWorkspaceFiles(id, 1)).toBe(true)
    expect(rows.get(id)?.workspaceFiles).toBe(1)
  })

  it("records once the initial notes of a version were placed, apart from the workspace files", async () => {
    const { bots, rows } = registry()
    const id = await bots.create({
      name: "Alpha",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    await bots.markWorkspaceFiles(id, 1)
    expect(bots.hasInitialNotes(id, 1)).toBe(false)
    await bots.markInitialNotes(id, 1)
    expect(bots.hasInitialNotes(id, 1)).toBe(true)
    expect(rows.get(id)).toMatchObject({ workspaceFiles: 1, initialNotes: 1 })
  })
})
