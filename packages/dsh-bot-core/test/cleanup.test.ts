import { describe, expect, it } from "vitest"
import { BotCleanupError, cleanupBotSessions } from "../src/host/cleanup"

const bot = { name: "Alpha", mainSessionId: "main", sessionIds: ["main", "s2"] }

function deps(options: { failArchive?: string; failDelete?: boolean } = {}) {
  const calls: string[] = []
  return {
    calls,
    deps: {
      archive: async (id: string) => {
        calls.push(`archive ${id}`)
        if (id === options.failArchive) throw new Error("busy")
      },
      deleteWorkspace: async (id: string) => {
        calls.push(`delete ${id}`)
        if (options.failDelete) throw new Error("io")
        return true
      },
    },
  }
}

describe("bot session cleanup", () => {
  it("archives every session once, and touches no Workspace", async () => {
    const { deps: d, calls } = deps()
    await cleanupBotSessions(d, bot)
    expect(calls).toEqual(["archive main", "archive s2"])
  })

  it("archives the Main even when it is not recorded among the sessions", async () => {
    const { deps: d, calls } = deps()
    await cleanupBotSessions(d, { ...bot, sessionIds: ["s2"] })
    expect(calls).toEqual(["archive s2", "archive main"])
  })

  it("deletes a legacy Workspace once every session is archived", async () => {
    const { deps: d, calls } = deps()
    await cleanupBotSessions(d, { ...bot, workspaceId: "w1" })
    expect(calls).toEqual(["archive main", "archive s2", "delete w1"])
  })

  it("keeps a legacy Workspace when a session could not be archived", async () => {
    const { deps: d, calls } = deps({ failArchive: "s2" })
    const failure = cleanupBotSessions(d, { ...bot, sessionIds: ["s2", "s3"], workspaceId: "w1" })
    await expect(failure).rejects.toBeInstanceOf(BotCleanupError)
    await expect(failure).rejects.toThrow("archive session s2: busy")
    expect(calls).toEqual(["archive s2", "archive s3", "archive main"])
  })

  it("reports a failed legacy Workspace deletion", async () => {
    const { deps: d } = deps({ failDelete: true })
    await expect(cleanupBotSessions(d, { ...bot, workspaceId: "w1" })).rejects.toThrow(
      "delete workspace w1: io",
    )
  })
})
