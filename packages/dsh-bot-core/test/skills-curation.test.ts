import { describe, expect, it, vi } from "vitest"
import {
  CURATION_EVERY_MS,
  CURATION_QUIET_MS,
  CURATION_RETRY_MS,
  calledForCuration,
  createSkillCuration,
  type SkillCurationDeps,
  SWEEP_EVERY_MS,
} from "../src/host/skills/curation"
import { createCurationRunner, createCuratorSessions } from "../src/host/skills/curation-run"
import { createSkillPanel } from "../src/host/skills/panel"
import {
  DAY_MS,
  namesSkill,
  UNUSED_ARCHIVE_MS,
  UNUSED_ARCHIVE_REASON,
} from "../src/host/skills/retention"
import { createSkillStore, type SkillStore } from "../src/host/skills/store"
import { CURATION_PROMPT, SLIM_BYTES } from "../src/host/skills/texts"
import { memoryTable } from "./support/skills-fs"
import { setup, signal, skillMd } from "./support/skills-setup"

const create = (manage: ReturnType<typeof setup>["manage"], name: string, body?: string) =>
  manage("main", { action: "create", name, content: skillMd(name, "d", body), reason: "r" })

const sweep = (h: ReturnType<typeof setup>) =>
  h.skills.sweep(
    "a",
    h.place,
    (skills) =>
      h.retentions.due(
        "a",
        skills.map((skill) => skill.name),
        h.clock.now,
      ),
    UNUSED_ARCHIVE_REASON,
    signal,
  )

describe("which skills the daily archive takes", () => {
  it("names a skill only as a whole word, not inside a longer kebab-case name", () => {
    expect(namesSkill("Follow the weekly-report skill.", "weekly-report")).toBe(true)
    expect(namesSkill("skills/weekly-report/SKILL.md", "weekly-report")).toBe(true)
    expect(namesSkill("Use Weekly-Report", "weekly-report")).toBe(true)
    expect(namesSkill("run weekly-report-v2", "weekly-report")).toBe(false)
    expect(namesSkill("the report", "weekly-report")).toBe(false)
    expect(namesSkill("my-report", "report")).toBe(false)
  })

  it("archives a skill neither loaded nor changed for 30 days, as the curator's version", async () => {
    const h = setup()
    await create(h.manage, "old")
    await create(h.manage, "fresh")
    h.clock.now += UNUSED_ARCHIVE_MS - DAY_MS
    await h.skills.load("a", "t", "fresh", signal)
    expect(h.retentions.of("a", "old")).toEqual({
      kind: "unused",
      archivesAt: (h.store.versions("a", "old")[0]?.at ?? 0) + UNUSED_ARCHIVE_MS,
    })
    expect(await sweep(h)).toEqual([])
    h.clock.now += 2 * DAY_MS
    expect(await sweep(h)).toEqual(["old"])
    expect(h.file("skills/old/SKILL.md")).toBeUndefined()
    expect(h.file("skills/.archive/old/SKILL.md")).toContain("name: old")
    expect(h.store.versions("a", "old")[0]).toMatchObject({
      operation: "archive",
      origin: { kind: "curator" },
      reason: "Unused for 30 days",
      archived: true,
    })
    expect(h.file("skills/fresh/SKILL.md")).toContain("name: fresh")
  })

  it("never archives a kept skill or one an armed schedule job names", async () => {
    const h = setup()
    await create(h.manage, "kept")
    await create(h.manage, "nightly-backup")
    await create(h.manage, "unused")
    await h.store.setKeep("a", "kept", true)
    h.jobTexts.push("Back up the photos with the nightly-backup skill.")
    h.clock.now += UNUSED_ARCHIVE_MS + DAY_MS
    expect(h.retentions.of("a", "kept")).toEqual({ kind: "kept" })
    expect(h.retentions.of("a", "nightly-backup")).toEqual({ kind: "scheduled" })
    expect(await sweep(h)).toEqual(["unused"])
  })

  it("first records a skill it has no record of, and counts from then", async () => {
    const h = setup()
    h.fs.put("/home/bot/workspace/skills/by-hand/SKILL.md", skillMd("by-hand", "Placed by hand."))
    expect(h.retentions.of("a", "by-hand")).toEqual({ kind: "unseen" })
    expect(await sweep(h)).toEqual([])
    expect(h.store.versions("a", "by-hand")[0]).toMatchObject({
      operation: "observed",
      origin: { kind: "files" },
    })
    h.clock.now += UNUSED_ARCHIVE_MS + DAY_MS
    expect(await sweep(h)).toEqual(["by-hand"])
  })

  it("counts a restored skill's days from its restore", async () => {
    const h = setup()
    await create(h.manage, "old")
    h.clock.now += UNUSED_ARCHIVE_MS + DAY_MS
    expect(await sweep(h)).toEqual(["old"])
    await h.skills.manageAsOwner("a", h.place, { action: "restore", name: "old" }, signal)
    expect(await sweep(h)).toEqual([])
    expect(h.retentions.of("a", "old")).toMatchObject({
      archivesAt: (h.store.versions("a", "old")[0]?.at ?? 0) + UNUSED_ARCHIVE_MS,
    })
  })
})

describe("a curation session", () => {
  it("may make three changes, recorded as the curator's", async () => {
    const h = setup()
    h.curators.add("cur-1", { botId: "a" })
    expect(h.skills.available("a", "t", "cur-1")).toBe(true)
    for (const name of ["a1", "a2", "a3"]) {
      await h.manage("cur-1", {
        action: "create",
        name,
        content: skillMd(name, "d"),
        reason: "split",
      })
    }
    await expect(
      h.manage("cur-1", { action: "create", name: "a4", content: skillMd("a4", "d"), reason: "r" }),
    ).rejects.toThrow("at most three changes")
    expect(await h.manage("cur-1", { action: "list" })).toContain("- a1")
    expect(h.store.versions("a", "a1")[0]?.origin).toEqual({ kind: "curator" })
  })

  it("never archives a kept skill in a merge, but may merge into it", async () => {
    const h = setup()
    await create(h.manage, "kept")
    await create(h.manage, "dup")
    await h.store.setKeep("a", "kept", true)
    h.curators.add("cur-1", { botId: "a" })
    expect(await h.manage("cur-1", { action: "list" })).toContain("marked keep by your owner")
    await expect(
      h.manage("cur-1", { action: "archive", name: "kept", reason: "r", absorbed_into: "dup" }),
    ).rejects.toThrow('your owner keeps skill "kept"')
    await expect(
      h.manage("cur-1", { action: "archive", name: "dup", reason: "r" }),
    ).rejects.toThrow("only when merging it")
    expect(
      await h.manage("cur-1", {
        action: "archive",
        name: "dup",
        reason: "same task",
        absorbed_into: "kept",
      }),
    ).toContain("merged into kept")
  })

  it("splits a kept skill: views it, moves a section to references/ and patches it", async () => {
    const h = setup()
    await create(h.manage, "big", "1. Step.\n\n## Rare cases\nOnly sometimes.")
    await h.store.setKeep("a", "big", true)
    h.curators.add("cur-1", { botId: "a" })
    await h.manage("cur-1", { action: "view", name: "big" })
    await h.manage("cur-1", {
      action: "write_file",
      name: "big",
      file_path: "references/rare.md",
      content: "## Rare cases\nOnly sometimes.\n",
      reason: "slim",
    })
    await h.manage("cur-1", {
      action: "patch",
      name: "big",
      old_text: "## Rare cases\nOnly sometimes.",
      new_text: "For rare cases read references/rare.md.",
      reason: "slim",
    })
    expect(h.file("skills/big/SKILL.md")).toContain("references/rare.md")
  })
})

describe("a curation run", () => {
  it("creates the curator Agent, prompts it once and ends with its turn", async () => {
    const sessions = createCuratorSessions()
    const prompts: string[] = []
    const dispose = vi.fn(async () => {})
    let recorded: unknown
    const runner = createCurationRunner({
      sessions,
      newId: () => "cur-1",
      async create(botId, sessionId) {
        recorded = [botId, sessionId, sessions.get(sessionId)]
        return { kind: "created", agent: { prompt: (text) => prompts.push(text), dispose } }
      },
      later: () => () => {},
      limitMs: 1000,
    })
    const done = runner.run("a")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(recorded).toEqual(["a", "cur-1", { botId: "a" }])
    expect(prompts).toEqual([CURATION_PROMPT])
    runner.sessionEvent("cur-1", { type: "turn/end" })
    expect(await done).toEqual({ kind: "ran" })
    expect(dispose).toHaveBeenCalledOnce()
    expect(sessions.get("cur-1")).toBeUndefined()
  })

  it("says why it could not run", async () => {
    const runner = createCurationRunner({
      sessions: createCuratorSessions(),
      newId: () => "cur-1",
      create: async () => ({ kind: "unavailable", reason: "no Main" }),
      later: () => () => {},
      limitMs: 1000,
    })
    expect(await runner.run("a")).toEqual({ kind: "unavailable", reason: "no Main" })
  })

  it("tells the curator its limits and to reply NO_REPLY when nothing needs doing", () => {
    expect(CURATION_PROMPT).toContain("Only skill_manage runs here")
    expect(CURATION_PROMPT).toContain("Make at most three changes")
    expect(CURATION_PROMPT).toContain("longer than 12 KB")
    expect(CURATION_PROMPT).toContain("Skills marked keep are never archived by a merge")
    expect(CURATION_PROMPT).toContain("reply with exactly NO_REPLY")
    expect(CURATION_PROMPT).toContain("Skill authoring standard:")
  })
})

function curation(
  options: { store?: SkillStore; skills?: { bytes: number }[]; start?: number } = {},
) {
  const store =
    options.store ??
    createSkillStore({
      skillHistory: memoryTable(),
      skillUsage: memoryTable(),
      skillSettings: memoryTable(),
      skillMarks: memoryTable(),
      skillCuration: memoryTable(),
    })
  const clock = { now: options.start ?? 1_700_000_000_000 }
  const timers: { at: number; work: () => void; cancelled: boolean }[] = []
  const swept: number[] = []
  const curated: number[] = []
  const state = {
    skills: options.skills ?? [{ bytes: 10 }, { bytes: 10 }],
    idle: true,
    available: true,
  }
  let finish: () => void = () => {}
  const deps: SkillCurationDeps = {
    bots: () => ["a"],
    store,
    async sweep() {
      if (!state.available) return "unavailable"
      swept.push(clock.now)
      return "swept"
    },
    skills: async () => (state.available ? state.skills : undefined),
    mainOf: () => "main",
    idle: () => state.idle,
    curate() {
      curated.push(clock.now)
      return new Promise((resolve) => {
        finish = () => resolve({ kind: "ran" })
      })
    },
    now: () => clock.now,
    later(ms, work) {
      const timer = { at: clock.now + ms, work, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    maxDelayMs: 2_147_483_647,
    warn: () => {},
  }
  const controller = createSkillCuration(deps)
  const settle = async () => {
    for (let round = 0; round < 10; round += 1) await Promise.resolve()
  }
  const advance = async (ms: number) => {
    const until = clock.now + ms
    for (;;) {
      const next = timers
        .filter((timer) => !timer.cancelled && timer.at <= until)
        .sort((a, b) => a.at - b.at)[0]
      if (next === undefined) break
      next.cancelled = true
      clock.now = Math.max(clock.now, next.at)
      next.work()
      await settle()
    }
    clock.now = until
    await settle()
  }
  return {
    controller,
    store,
    clock,
    swept,
    curated,
    state,
    advance,
    settle,
    finish: () => finish(),
  }
}

describe("when the curation runs", () => {
  it("archives unused skills once a day", async () => {
    const h = curation()
    h.controller.sync()
    await h.settle()
    expect(h.swept).toHaveLength(1)
    await h.advance(SWEEP_EVERY_MS - 1000)
    expect(h.swept).toHaveLength(1)
    await h.advance(1000)
    expect(h.swept).toHaveLength(2)
    expect(h.store.curation("a").sweptAt).toBe(h.swept[1])
    h.controller.dispose()
  })

  it("curates once a week, after the Main has been quiet for 30 seconds", async () => {
    const h = curation()
    h.controller.sync()
    await h.advance(CURATION_QUIET_MS - 1000)
    h.controller.activity("main")
    await h.advance(CURATION_QUIET_MS - 1000)
    expect(h.curated).toEqual([])
    await h.advance(1000)
    expect(h.curated).toHaveLength(1)
    h.finish()
    await h.settle()
    expect(h.store.curation("a").curatedAt).toBe(h.curated[0])
    const due = (h.curated[0] ?? 0) + CURATION_EVERY_MS
    await h.advance(due + CURATION_QUIET_MS - 1000 - h.clock.now)
    expect(h.curated).toHaveLength(1)
    await h.advance(1000)
    expect(h.curated).toEqual([h.curated[0], due + CURATION_QUIET_MS])
    h.controller.dispose()
  })

  it("waits for a Main that is working, and starts the quiet wait again when it is done", async () => {
    const h = curation()
    h.state.idle = false
    h.controller.sync()
    await h.advance(CURATION_QUIET_MS)
    expect(h.curated).toEqual([])
    h.state.idle = true
    h.controller.activity("main")
    await h.advance(CURATION_QUIET_MS)
    expect(h.curated).toHaveLength(1)
    h.controller.dispose()
  })

  it("keeps counting from the stored times after a restart", async () => {
    const first = curation()
    first.controller.sync()
    await first.advance(CURATION_QUIET_MS)
    first.finish()
    await first.settle()
    first.controller.dispose()
    const second = curation({ store: first.store, start: first.clock.now + 3 * DAY_MS })
    second.controller.sync()
    await second.advance(CURATION_QUIET_MS)
    expect(second.swept).toHaveLength(1)
    expect(second.curated).toEqual([])
    await second.advance(4 * DAY_MS)
    expect(second.curated).toEqual([
      (first.curated[0] ?? 0) + CURATION_EVERY_MS + CURATION_QUIET_MS,
    ])
    second.controller.dispose()
  })

  it("curates only when the skills call for it: two or more, or a SKILL.md over 12 KiB", async () => {
    expect(calledForCuration([{ bytes: 10 }])).toBe(false)
    expect(calledForCuration([{ bytes: 10 }, { bytes: 10 }])).toBe(true)
    expect(calledForCuration([{ bytes: SLIM_BYTES + 1 }])).toBe(true)
    const h = curation({ skills: [{ bytes: 10 }] })
    h.controller.sync()
    await h.advance(CURATION_QUIET_MS)
    await h.advance(CURATION_RETRY_MS * 3)
    expect(h.curated).toEqual([])
    expect(h.store.curation("a").curatedAt).toBeUndefined()
    h.state.skills = [{ bytes: 10 }, { bytes: 20 }]
    h.controller.sync("a")
    await h.advance(CURATION_QUIET_MS)
    expect(h.curated).toHaveLength(1)
    h.controller.dispose()
  })

  it("does not curate while skillCurator is off; the daily archive still runs", async () => {
    const h = curation()
    await h.store.setCurator("a", false)
    h.controller.sync()
    await h.advance(CURATION_QUIET_MS * 2)
    expect(h.curated).toEqual([])
    expect(h.swept).toHaveLength(1)
    await h.store.setCurator("a", true)
    h.controller.sync("a")
    await h.advance(CURATION_QUIET_MS)
    expect(h.curated).toHaveLength(1)
    h.controller.dispose()
  })

  it("tries again later, without a stored time, while the skills cannot be read", async () => {
    const h = curation()
    h.state.available = false
    h.controller.sync()
    await h.advance(CURATION_QUIET_MS)
    expect(h.swept).toEqual([])
    expect(h.store.curation("a")).toEqual({})
    h.state.available = true
    await h.advance(CURATION_RETRY_MS)
    expect(h.swept).toHaveLength(1)
    await h.advance(CURATION_QUIET_MS)
    expect(h.curated).toHaveLength(1)
    h.controller.dispose()
  })
})

describe("the Web UI's keep marks and curation setting", () => {
  it("marks a skill keep, switches the curation and shows when each skill is archived", async () => {
    const h = setup()
    await create(h.manage, "s")
    const panel = createSkillPanel({
      skills: h.skills,
      store: h.store,
      retentions: h.retentions,
      placeOf: () => h.place,
      exists: (botId) => botId === "a",
      deadline: () => signal,
    })
    const published = new Promise<void>((resolve) => panel.subscribe(() => resolve()))
    const unfollow = panel.follow("a")
    await published
    const at = (h.store.versions("a", "s")[0]?.at ?? 0) + UNUSED_ARCHIVE_MS
    expect(panel.view("a").library).toMatchObject({
      skills: [{ name: "s", keep: false, retention: { kind: "unused", archivesAt: at } }],
    })
    await expect(panel.setKeep("a", "nope", true)).rejects.toThrow('no skill "nope"')
    await expect(panel.setKeep("a", "s", "yes")).rejects.toThrow("true or false")
    expect((await panel.setKeep("a", "s", true)).library).toMatchObject({
      skills: [{ name: "s", keep: true, retention: { kind: "kept" } }],
    })
    await panel.setKeep("a", "s", false)
    h.jobTexts.push("Use skill s every morning")
    const told = vi.fn()
    panel.subscribe(told)
    panel.jobsChanged()
    expect(told).toHaveBeenCalledWith("a")
    expect(panel.view("a").library).toMatchObject({
      skills: [{ retention: { kind: "scheduled" } }],
    })
    expect((await panel.setCurator("a", false)).curator).toBe(false)
    expect(h.store.curatorEnabled("a")).toBe(false)
    expect(h.store.reviewEnabled("a")).toBe(true)
    await panel.setReview("a", false)
    expect(h.store.curatorEnabled("a")).toBe(false)
    unfollow()
    panel.dispose()
  })
})
