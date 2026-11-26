import { describe, expect, it } from "vitest"
import { createAccountCleaner, ensureAccount } from "../src/host/accounts"
import { catchUp } from "../src/host/catch-up"
import { HomeserverRefusal, homeserverOf } from "../src/host/homeserver"
import { MatrixError } from "../src/host/matrix"
import { openAccountRecords } from "../src/host/records/accounts"
import { openHomeRecords } from "../src/host/records/homes"
import { MATRIX_SERVERS } from "../src/host/servers"
import { createMatrixSettingsQueries } from "../src/host/settings/queries"
import type { MatrixShared } from "../src/host/shared-fields"
import { runSyncLoop } from "../src/host/sync-loop"
import { event, fakeApi, immediate, memoryTables } from "./support"

const signal = new AbortController().signal
const shared = (server: string): MatrixShared => ({
  server,
  homeserver: "https://hs.example",
  asToken: "tok",
  prefix: "dshbots",
  defaultOwner: "@alice:example.org",
})

describe("Matrix accounts", () => {
  it("registers a bot as the application service, names it once and records it active", async () => {
    const tables = memoryTables()
    const records = openAccountRecords(tables, () => 5)
    const api = fakeApi()
    const home = homeserverOf(() => api, shared("synapse"))
    const account = await ensureAccount(home, records, { id: "b1", name: "Bot" }, signal)
    expect(account.userId).toBe("@dshbots_b1:example.org")
    expect(api.calls.map((call) => [call.method, call.user])).toEqual([
      ["register", undefined],
      ["setDisplayName", "@dshbots_b1:example.org"],
    ])
    expect(records.get("b1")).toMatchObject({ state: "active", serverName: "example.org" })
  })

  it("refuses a registration file whose sender or namespace does not fit the prefix", async () => {
    const records = openAccountRecords(memoryTables(), () => 5)
    const wrongSender = homeserverOf(
      () => fakeApi({ whoami: async () => "@other:example.org" }),
      shared("synapse"),
    )
    await expect(
      ensureAccount(wrongSender, records, { id: "b1", name: "Bot" }, signal),
    ).rejects.toBeInstanceOf(HomeserverRefusal)
    const outside = homeserverOf(
      () =>
        fakeApi({
          register: async () => {
            throw new MatrixError("exclusive", "M_EXCLUSIVE")
          },
        }),
      shared("synapse"),
    )
    await expect(
      ensureAccount(outside, records, { id: "b1", name: "Bot" }, signal),
    ).rejects.toThrow("namespace")
  })

  it("cleans up the account of a deleted bot: leaves, clears the profile, retires it as the server can", async () => {
    for (const [server, retirement, deactivated] of [
      ["synapse", "deactivated", true],
      ["tuwunel", "vacated", false],
    ] as const) {
      const tables = memoryTables()
      const records = openAccountRecords(tables, () => 5)
      await records.activate("gone", "@dshbots_gone:example.org", "example.org")
      await records.activate("kept", "@dshbots_kept:example.org", "example.org")
      await tables.homes.put("gone", {
        botId: "gone",
        owner: "@alice:example.org",
        roomId: "!dm",
        updatedAt: 1,
      })
      const api = fakeApi({ joinedRooms: async () => ["!dm"] })
      const cleaner = createAccountCleaner({ open: () => api, records, tables, warn: () => {} })
      await cleaner.reconcile({
        listed: (botId) => botId === "kept",
        shared: shared(server),
        signal,
      })
      expect(records.get("gone")).toMatchObject({ state: "retired", retirement })
      expect(records.get("kept")?.state).toBe("active")
      expect(tables.homes.get("gone")).toBeUndefined()
      const methods = api.calls
        .filter((call) => call.user === "@dshbots_gone:example.org")
        .map((call) => call.method)
      expect(methods).toEqual(
        expect.arrayContaining(["leave", "forget", "setDisplayName", "setAvatarUrl"]),
      )
      expect(methods.includes("deactivate")).toBe(deactivated)
    }
  })

  it("keeps a failed clean-up retiring and tries it again later", async () => {
    const tables = memoryTables()
    const records = openAccountRecords(tables, () => 5)
    await records.activate("gone", "@dshbots_gone:example.org", "example.org")
    const warnings: string[] = []
    const api = fakeApi({
      joinedRooms: async () => {
        throw new MatrixError("unreachable", "down")
      },
    })
    await createAccountCleaner({
      open: () => api,
      records,
      tables,
      warn: (message) => warnings.push(message),
    }).reconcile({ listed: () => false, shared: shared("synapse"), signal })
    expect(records.get("gone")?.state).toBe("retiring")
    expect(warnings).toHaveLength(1)
  })
})

describe("Matrix homeserver kinds", () => {
  it("identify themselves only by their own endpoint", async () => {
    const api = fakeApi({
      unauthenticated: async (path) =>
        path === "/_synapse/admin/v1/server_version" ? { server_version: "1.166.0" } : undefined,
    })
    expect(await MATRIX_SERVERS.synapse.identify(api, signal)).toEqual({ version: "1.166.0" })
    expect(await MATRIX_SERVERS.tuwunel.identify(api, signal)).toBeUndefined()
  })

  it("let the shared check refuse a server that is not the chosen kind, and a prefix change under live accounts", async () => {
    const tables = memoryTables()
    const accounts = openAccountRecords(tables, () => 1)
    const queries = createMatrixSettingsQueries({
      open: () => fakeApi({ unauthenticated: async () => ({ server_version: "1" }) }),
      accounts,
      homes: openHomeRecords(tables, () => 1),
    })
    expect(await queries.checkShared({ shared: shared("synapse"), signal })).toEqual({ ok: true })
    expect(await queries.checkShared({ shared: shared("tuwunel"), signal })).toMatchObject({
      ok: false,
      reason: { en: expect.stringContaining("Tuwunel") },
    })
    await accounts.activate("b1", "@old_b1:example.org", "example.org")
    expect(await queries.checkShared({ shared: shared("synapse"), signal })).toMatchObject({
      ok: false,
      reason: { en: expect.stringContaining("cannot change") },
    })
  })

  it("set a new bot up in a direct chat with the default owner, in the bot's language", async () => {
    const tables = memoryTables()
    const queries = createMatrixSettingsQueries({
      open: () => fakeApi(),
      accounts: openAccountRecords(tables, () => 1),
      homes: openHomeRecords(tables, () => 1),
    })
    expect(
      await queries.initialSettings({
        bot: { id: "b", name: "B", language: "ja-JP" },
        shared: shared("synapse"),
        signal,
      }),
    ).toMatchObject({
      state: "ready",
      values: { home: "dm", approvers: ["@alice:example.org"], language: "ja" },
      profileSync: true,
    })
    expect(queries.describeInitial({ ...shared("synapse"), defaultOwner: "" })).toMatchObject({
      state: "unavailable",
    })
  })
})

describe("Matrix sync", () => {
  it("walks back from prev_batch to the last delivered event, oldest first", async () => {
    const pages = [
      { chunk: [event({ eventId: "$5" }), event({ eventId: "$4" })], end: "p2" },
      { chunk: [event({ eventId: "$3" }), event({ eventId: "$2" })], end: "p3" },
    ]
    let at = 0
    const caught = await catchUp(
      { messages: async () => pages[at++] ?? { chunk: [] } },
      "!r",
      "p1",
      "$2",
      signal,
    )
    expect(caught).toEqual({
      events: [event({ eventId: "$3" }), event({ eventId: "$4" }), event({ eventId: "$5" })],
      complete: true,
    })
  })

  it("drops a refused position once, saves each batch after handling it, and stops on a refused token", async () => {
    const seen: (string | undefined)[] = []
    const saved: string[] = []
    const states: string[] = []
    let calls = 0
    await runSyncLoop({
      api: {
        sync: async (request) => {
          seen.push(request.since)
          calls += 1
          if (calls === 1) throw new MatrixError("bad-since", "M_UNKNOWN", 400)
          if (calls === 2)
            return { nextBatch: "n1", joined: new Map(), invited: new Map(), left: new Set() }
          if (calls === 3) throw new MatrixError("unreachable", "down")
          throw new MatrixError("token", "M_UNKNOWN_TOKEN", 401)
        },
      },
      scheduler: immediate,
      signal,
      since: () => "old",
      handle: async () => {},
      saved: async (next) => void saved.push(next),
      healthy: () => states.push("healthy"),
      unhealthy: () => states.push("unhealthy"),
      refused: () => states.push("refused"),
      warn: () => {},
    })
    expect(seen).toEqual(["old", undefined, "n1", "n1"])
    expect(saved).toEqual(["n1"])
    expect(states).toEqual(["healthy", "unhealthy", "refused"])
  })
})
