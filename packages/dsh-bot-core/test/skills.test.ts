import { describe, expect, it, vi } from "vitest"
import { createSkillLibrary } from "../src/host/skills/library"
import { createSkillPanel } from "../src/host/skills/panel"
import { createSkillRetentions } from "../src/host/skills/retention"
import {
  createReviewSessions,
  createSkillReviews,
  REVIEW_QUIET_MS,
  REVIEW_STEPS,
} from "../src/host/skills/review"
import { completedTurns, createReviewRunner } from "../src/host/skills/review-run"
import { descriptionWarning, parseSkill } from "../src/host/skills/skill"
import { REVIEW_PROMPT } from "../src/host/skills/texts"
import { SKILL_VERSION_LIMIT } from "../src/shared/skills"
import { setup, signal, skillMd, WORKSPACE } from "./support/skills-setup"

describe("the form of a skill", () => {
  it("reads name and description, then the instructions", () => {
    expect(
      parseSkill(skillMd("weekly-report", "When the owner asks for the weekly report.")),
    ).toEqual({
      ok: true,
      value: {
        name: "weekly-report",
        description: "When the owner asks for the weekly report.",
        body: "1. Do the thing.\n2. Check it.\n",
      },
    })
    expect(parseSkill("---\nname: \"a-b\"\ndescription: 'It''s one'\n---\nbody")).toMatchObject({
      ok: true,
      value: { name: "a-b", description: "It's one" },
    })
  })

  it("refuses other keys, a bad name, no description and no instructions", () => {
    expect(parseSkill(skillMd("x", "d").replace("name: x", "name: x\nversion: 2"))).toMatchObject({
      ok: false,
      problem: expect.stringContaining('unknown frontmatter key "version"'),
    })
    expect(parseSkill(skillMd("Bad_Name", "d"))).toMatchObject({
      ok: false,
      problem: expect.stringContaining("kebab-case"),
    })
    expect(parseSkill("---\nname: x\n---\nbody")).toMatchObject({
      ok: false,
      problem: "the frontmatter has no description",
    })
    expect(parseSkill(skillMd("x", "d", ""))).toMatchObject({
      ok: false,
      problem: expect.stringContaining("no instructions"),
    })
    expect(parseSkill("no frontmatter")).toMatchObject({ ok: false })
  })

  it("warns about a description over 160 bytes", () => {
    expect(descriptionWarning("short")).toBeUndefined()
    expect(descriptionWarning("あ".repeat(60))).toContain("180 bytes")
  })
})

describe("the skills in skills/", () => {
  it("lists only skills/<name>/SKILL.md, reports what is not a skill, and reads only what changed", async () => {
    const { fs, place } = setup()
    fs.put(`${WORKSPACE}/skills/good/SKILL.md`, skillMd("good", "Good."))
    fs.put(`${WORKSPACE}/skills/other/SKILL.md`, skillMd("else", "Named apart."))
    fs.put(`${WORKSPACE}/skills/flat.md`, skillMd("flat", "Flat."))
    fs.put(`${WORKSPACE}/skills/.archive/old/SKILL.md`, skillMd("old", "Old."))
    fs.put(`${WORKSPACE}/.agents/skills/elsewhere/SKILL.md`, skillMd("elsewhere", "Not read."))
    fs.put(`${WORKSPACE}/skills/empty/references/a.md`, "left over")
    const library = createSkillLibrary()
    const first = await library.scan(place, signal)
    expect(first.skills.map((skill) => skill.name)).toEqual(["good"])
    expect(first.invalid).toEqual([
      { path: "skills/flat.md", problem: "a skill is a directory <name>/ holding SKILL.md" },
      {
        path: "skills/other/SKILL.md",
        problem: 'its name "else" differs from its directory "other"',
      },
    ])
    const reads = fs.reads.length
    const again = await library.scan(place, signal)
    expect(fs.reads.length).toBe(reads)
    expect(again.fingerprint).toBe(first.fingerprint)
    fs.put(`${WORKSPACE}/skills/good/SKILL.md`, skillMd("good", "Better."))
    const changed = await library.scan(place, signal)
    expect(fs.reads.length).toBe(reads + 1)
    expect(changed.fingerprint).not.toBe(first.fingerprint)
    expect(await library.archived(place, signal)).toMatchObject([
      { name: "old", skill: { ok: true } },
    ])
  })
})

describe("skill_manage", () => {
  it("creates a skill and lists it with when it was last used", async () => {
    const { manage, file, skills, store } = setup()
    expect(await manage("main", { action: "list" })).toBe("No skills yet.")
    expect(
      await manage("main", {
        action: "create",
        name: "weekly-report",
        content: skillMd("weekly-report", "When the owner asks for the weekly report."),
        reason: "the owner asks every Friday",
      }),
    ).toBe("Created skill weekly-report (version v1).")
    expect(file("skills/weekly-report/SKILL.md")).toContain("name: weekly-report")
    expect(store.versions("a", "weekly-report")).toMatchObject([
      {
        id: "v1",
        operation: "create",
        origin: { kind: "conversation", sessionId: "main" },
        archived: false,
      },
    ])
    expect(await manage("main", { action: "list" })).toBe(
      "Skills:\n- weekly-report: When the owner asks for the weekly report. (never used)",
    )
    const loaded = await skills.load("a", "t", "weekly-report", signal)
    expect(loaded).toMatchObject({
      directory: `${WORKSPACE}/skills/weekly-report`,
      content: "1. Do the thing.\n2. Check it.\n",
    })
    expect(store.usage("a", "weekly-report").uses).toBe(1)
    expect(await manage("main", { action: "list" })).toContain("(last used 2026-11-24)")
  })

  it("writes nothing when a check fails", async () => {
    const { manage, fs, store } = setup()
    const before = fs.files.size
    await expect(
      manage("main", { action: "create", name: "x", content: skillMd("y", "d"), reason: "r" }),
    ).rejects.toThrow('its name "y" must be the skill\'s name "x"')
    await expect(
      manage("main", { action: "create", name: "x", content: "no frontmatter", reason: "r" }),
    ).rejects.toThrow("frontmatter")
    await expect(
      manage("main", { action: "create", name: "x", content: skillMd("x", "d") }),
    ).rejects.toThrow("reason")
    await expect(
      manage("main", { action: "create", name: "Bad", content: skillMd("Bad", "d"), reason: "r" }),
    ).rejects.toThrow("kebab-case")
    expect(fs.files.size).toBe(before)
    expect(store.names("a")).toEqual([])
  })

  it("patches only a file the Agent viewed as it is now", async () => {
    const { manage, fs, file, store } = setup()
    await manage("main", { action: "create", name: "s", content: skillMd("s", "d"), reason: "r" })
    await expect(
      manage("web", {
        action: "patch",
        name: "s",
        old_text: "Do the thing",
        new_text: "Do it",
        reason: "r",
      }),
    ).rejects.toThrow("view skills/s/SKILL.md first")
    const view = await manage("web", { action: "view", name: "s" })
    expect(view).toContain("skills/s/SKILL.md:")
    expect(view).toContain("History (newest first):\n- v1 2026-11-24 create — r")
    await expect(
      manage("web", {
        action: "patch",
        name: "s",
        old_text: "missing",
        new_text: "x",
        reason: "r",
      }),
    ).rejects.toThrow("does not appear")
    await expect(
      manage("web", { action: "patch", name: "s", old_text: ".", new_text: "!", reason: "r" }),
    ).rejects.toThrow(/appears \d+ times/)
    await expect(
      manage("web", {
        action: "patch",
        name: "s",
        old_text: "name: s",
        new_text: "name: t",
        reason: "r",
      }),
    ).rejects.toThrow("must be the skill's name")
    expect(
      await manage("web", {
        action: "patch",
        name: "s",
        old_text: "Do the thing",
        new_text: "Do it",
        reason: "shorter",
      }),
    ).toBe("Patched skills/s/SKILL.md (version v2).")
    expect(file("skills/s/SKILL.md")).toContain("1. Do it.")
    fs.put(`${WORKSPACE}/skills/s/SKILL.md`, skillMd("s", "d", "Edited by bash."))
    await expect(
      manage("web", {
        action: "patch",
        name: "s",
        old_text: "Edited",
        new_text: "Changed",
        reason: "r",
      }),
    ).rejects.toThrow("changed since you viewed it")
    await manage("web", { action: "view", name: "s" })
    await manage("web", {
      action: "patch",
      name: "s",
      old_text: "Edited",
      new_text: "Changed",
      reason: "r",
    })
    expect(
      store.versions("a", "s").map((version) => [version.operation, version.origin.kind]),
    ).toEqual([
      ["patch", "conversation"],
      ["observed", "files"],
      ["patch", "conversation"],
      ["create", "conversation"],
    ])
  })

  it("keeps supporting files only under references/, templates/, scripts/ and assets/", async () => {
    const { manage, file, store } = setup()
    await manage("main", { action: "create", name: "s", content: skillMd("s", "d"), reason: "r" })
    await expect(
      manage("main", {
        action: "write_file",
        name: "s",
        file_path: "notes.txt",
        content: "x",
        reason: "r",
      }),
    ).rejects.toThrow("supporting files go under")
    await expect(
      manage("main", {
        action: "write_file",
        name: "s",
        file_path: "references/../x.md",
        content: "x",
        reason: "r",
      }),
    ).rejects.toThrow("may not be empty or start with a dot")
    await manage("main", {
      action: "write_file",
      name: "s",
      file_path: "references/api.md",
      content: "API",
      reason: "r",
    })
    expect(file("skills/s/references/api.md")).toBe("API")
    await expect(
      manage("web", {
        action: "write_file",
        name: "s",
        file_path: "references/api.md",
        content: "new",
        reason: "r",
      }),
    ).rejects.toThrow("view skills/s/references/api.md first")
    expect(await manage("main", { action: "view", name: "s" })).toContain(
      "Supporting files:\n- references/api.md",
    )
    await manage("main", {
      action: "remove_file",
      name: "s",
      file_path: "references/api.md",
      reason: "r",
    })
    expect(file("skills/s/references/api.md")).toBeUndefined()
    expect(store.versions("a", "s")[0]?.files.map((item) => item.path)).toEqual(["SKILL.md"])
  })

  it("archives a skill merged into another, restores it, and undoes the latest change", async () => {
    const { manage, file } = setup()
    await manage("main", {
      action: "create",
      name: "keep",
      content: skillMd("keep", "d"),
      reason: "r",
    })
    await manage("main", {
      action: "create",
      name: "dup",
      content: skillMd("dup", "d"),
      reason: "r",
    })
    await expect(
      manage("main", { action: "archive", name: "dup", reason: "r", absorbed_into: "nope" }),
    ).rejects.toThrow('no active skill "nope"')
    expect(
      await manage("main", {
        action: "archive",
        name: "dup",
        reason: "merged",
        absorbed_into: "keep",
      }),
    ).toBe("Archived skill dup (version v3), merged into keep.")
    expect(file("skills/dup/SKILL.md")).toBeUndefined()
    expect(file("skills/.archive/dup/SKILL.md")).toContain("name: dup")
    expect(await manage("main", { action: "list" })).toContain("- dup (archived: true): d")
    await expect(
      manage("main", { action: "create", name: "dup", content: skillMd("dup", "d"), reason: "r" }),
    ).rejects.toThrow("archived skill is named")
    expect(await manage("main", { action: "restore", name: "dup" })).toBe(
      "Restored skill dup to version v3 (new version v4).",
    )
    expect(file("skills/dup/SKILL.md")).toContain("name: dup")
    expect(file("skills/.archive/dup/SKILL.md")).toBeUndefined()

    await manage("main", { action: "view", name: "keep" })
    await manage("main", {
      action: "patch",
      name: "keep",
      old_text: "Do the thing",
      new_text: "Do it",
      reason: "r",
    })
    expect(await manage("main", { action: "restore", name: "keep" })).toBe(
      "Restored skill keep to version v1 (new version v6).",
    )
    expect(file("skills/keep/SKILL.md")).toContain("Do the thing")
    await expect(
      manage("main", { action: "restore", name: "keep", version: "v99" }),
    ).rejects.toThrow('no version "v99"')
    expect(await manage("main", { action: "view", name: "keep", version: "v5" })).toContain(
      "1. Do it.",
    )
  })

  it("keeps the latest 20 versions of a skill", async () => {
    const { manage, store } = setup()
    await manage("main", {
      action: "create",
      name: "s",
      content: skillMd("s", "d", "step 0"),
      reason: "r",
    })
    for (let index = 1; index <= SKILL_VERSION_LIMIT + 4; index += 1) {
      await manage("main", { action: "view", name: "s" })
      await manage("main", {
        action: "patch",
        name: "s",
        old_text: `step ${index - 1}`,
        new_text: `step ${index}`,
        reason: "r",
      })
    }
    const versions = store.versions("a", "s")
    expect(versions).toHaveLength(SKILL_VERSION_LIMIT)
    expect(versions[0]?.files[0]?.text).toContain(`step ${SKILL_VERSION_LIMIT + 4}`)
    expect(versions.some((version) => version.operation === "create")).toBe(false)
  })

  it("is shown and runs only in Main and Web sessions; schedule runs and subagents only read skills", async () => {
    const { skills, manage } = setup()
    expect(
      ["main", "web", "run", "helper", "stranger"].map((agent) =>
        skills.available("a", "t", agent),
      ),
    ).toEqual([true, true, false, false, false])
    expect(skills.available("a", "other-token", "main")).toBe(false)
    for (const agent of ["run", "helper"]) {
      await expect(manage(agent, { action: "list" })).rejects.toThrow(
        "only in your conversations with your owner",
      )
    }
  })

  it("lets a review make one change, recorded as the review's", async () => {
    const { skills, reviews, manage, store } = setup()
    reviews.add("review-1", { botId: "a", sessionId: "main", kind: "main" })
    expect(skills.available("a", "t", "review-1")).toBe(true)
    await manage("review-1", { action: "list" })
    await manage("review-1", {
      action: "create",
      name: "s",
      content: skillMd("s", "d"),
      reason: "worked after trial",
    })
    await expect(
      manage("review-1", { action: "create", name: "t", content: skillMd("t", "d"), reason: "r" }),
    ).rejects.toThrow("at most one change")
    expect(await manage("review-1", { action: "view", name: "s" })).toContain("skills/s/SKILL.md")
    expect(store.versions("a", "s")[0]?.origin).toEqual({ kind: "review", sessionId: "main" })
  })

  it("counts the steps of Main and Web sessions, not of reviews, and tells the row when skills/ changed", async () => {
    const { skills, fs, reviews, stepped } = setup()
    const changed = vi.fn()
    skills.watch("a", "t", changed)
    await skills.prepare("a", "t", "main", signal)
    fs.put(`${WORKSPACE}/skills/new/SKILL.md`, skillMd("new", "From bash."))
    reviews.add("review-1", { botId: "a", sessionId: "main", kind: "main" })
    await skills.prepare("a", "t", "review-1", signal)
    await skills.prepare("a", "t", "run", signal)
    await skills.prepare("a", "t", "web", signal)
    expect(stepped).toEqual(["main", "web"])
    expect(changed).toHaveBeenCalledTimes(1)
    expect((await skills.list("a", "t", signal)).map((entry) => entry.name)).toEqual(["new"])
    await expect(skills.list("a", "bad", signal)).rejects.toThrow("not registered")
  })
})

describe("the Web UI's skills", () => {
  it("shows the skills once read, restores a version as the owner's, and switches the review", async () => {
    const { skills, store, place, manage } = setup()
    await manage("main", { action: "create", name: "s", content: skillMd("s", "d"), reason: "r" })
    await manage("main", { action: "view", name: "s" })
    await manage("main", {
      action: "patch",
      name: "s",
      old_text: "Do the thing",
      new_text: "Do it",
      reason: "r",
    })
    const panel = createSkillPanel({
      skills,
      store,
      retentions: createSkillRetentions({ store, jobTexts: () => [] }),
      placeOf: () => place,
      exists: (botId) => botId === "a",
      deadline: () => signal,
    })
    expect(panel.view("a")).toEqual({
      botId: "a",
      review: true,
      curator: true,
      library: { state: "loading" },
    })
    const published = new Promise<void>((resolve) => panel.subscribe(() => resolve()))
    const unfollow = panel.follow("a")
    await published
    expect(panel.view("a").library).toEqual({
      state: "ready",
      skills: [
        {
          name: "s",
          description: "d",
          archived: false,
          keep: false,
          retention: { kind: "unused", archivesAt: expect.any(Number) },
          uses: 0,
          versions: 2,
        },
      ],
      invalid: [],
    })
    const restored = await panel.restoreVersion("a", "s", "v1")
    expect(restored.versions[0]).toMatchObject({ operation: "restore", origin: { kind: "owner" } })
    expect(panel.version("a", "s", "v1").files[0]?.text).toContain("Do the thing")
    await expect(panel.restoreArchived("a", "s")).rejects.toThrow("not archived")
    await expect(panel.setReview("a", "no")).rejects.toThrow("true or false")
    expect((await panel.setReview("a", false)).review).toBe(false)
    expect(store.reviewEnabled("a")).toBe(false)
    expect(() => panel.view("b")).toThrow("does not exist")
    unfollow()
    panel.dispose()
  })
})

describe("when the background review runs", () => {
  function controller(options: { enabled?: boolean; idle?: boolean } = {}) {
    const timers: { ms: number; work: () => void; cancelled: boolean }[] = []
    const runs: string[] = []
    let finish: () => void = () => {}
    const reviews = createSkillReviews({
      enabled: () => options.enabled ?? true,
      idle: () => options.idle ?? true,
      run: (_botId, sessionId) => {
        runs.push(sessionId)
        return new Promise<void>((resolve) => {
          finish = resolve
        })
      },
      later(ms, work) {
        const timer = { ms, work, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
      warn: () => {},
    })
    const fire = () => {
      for (const timer of timers.filter((item) => !item.cancelled)) {
        timer.cancelled = true
        timer.work()
      }
    }
    return { reviews, timers, runs, fire, finish: () => finish() }
  }

  it("starts 30 seconds after a turn ends once 10 steps were taken since the last review", async () => {
    const { reviews, timers, runs, fire, finish } = controller()
    for (let step = 1; step < REVIEW_STEPS; step += 1) reviews.stepped("a", "main")
    reviews.turnEnded("a", "main")
    expect(timers).toHaveLength(0)
    reviews.stepped("a", "main")
    reviews.turnEnded("a", "main")
    expect(timers.at(-1)?.ms).toBe(REVIEW_QUIET_MS)
    fire()
    expect(runs).toEqual(["main"])
    expect(reviews.reviewing("main")).toBe(true)
    for (let step = 0; step < REVIEW_STEPS; step += 1) reviews.stepped("a", "main")
    reviews.turnEnded("a", "main")
    expect(timers.filter((timer) => !timer.cancelled)).toHaveLength(0)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    reviews.turnEnded("a", "main")
    fire()
    expect(runs).toEqual(["main", "main"])
  })

  it("waits again when the session works before the quiet time is over", () => {
    const { reviews, timers, runs, fire } = controller()
    for (let step = 0; step < REVIEW_STEPS; step += 1) reviews.stepped("a", "web")
    reviews.turnEnded("a", "web")
    reviews.busy("web")
    expect(timers[0]?.cancelled).toBe(true)
    fire()
    expect(runs).toEqual([])
  })

  it("does not run while the bot's skillReview is off, or while the session is not idle", () => {
    for (const options of [{ enabled: false }, { idle: false }]) {
      const { reviews, runs, fire } = controller(options)
      for (let step = 0; step < REVIEW_STEPS; step += 1) reviews.stepped("a", "main")
      reviews.turnEnded("a", "main")
      fire()
      expect(runs).toEqual([])
    }
  })
})

describe("a background review", () => {
  it("seeds an Agent with the session's completed turns on its preset and route, prompts it once and ends with its turn", async () => {
    const events = [
      { type: "session/start", seq: 0 },
      { type: "turn/start", seq: 1 },
      { type: "turn/end", seq: 2 },
      { type: "turn/start", seq: 3 },
    ]
    expect(completedTurns(events)).toEqual(events.slice(0, 3))
    const reviews = createReviewSessions()
    const created: unknown[] = []
    const prompts: string[] = []
    const disposed = vi.fn(async () => {})
    let recorded: unknown
    const runner = createReviewRunner({
      source: () => ({
        id: "main",
        session: {
          header: { cwd: WORKSPACE, agentPreset: "bot-a" },
          snapshotEvents: () => events,
          requestHeader: () => ({ config: { provider: "p", model: "m", reasoningEffort: "high" } }),
        },
      }),
      kind: () => "main",
      reviews,
      newId: () => "review-1",
      async create(request) {
        created.push(request)
        recorded = reviews.get("review-1")
        return { prompt: (text) => prompts.push(text), dispose: disposed }
      },
      later: () => () => {},
      limitMs: 1000,
    })
    const done = runner.run("a", "main")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(created).toEqual([
      {
        reviewId: "review-1",
        parentSession: "main",
        cwd: WORKSPACE,
        agentPreset: "bot-a",
        seed: events.slice(0, 3),
        route: { provider: "p", model: "m", reasoningEffort: "high" },
      },
    ])
    expect(recorded).toEqual({ botId: "a", sessionId: "main", kind: "main" })
    expect(prompts).toEqual([REVIEW_PROMPT])
    runner.sessionEvent("review-1", { type: "turn/end" })
    await done
    expect(disposed).toHaveBeenCalledOnce()
    expect(reviews.get("review-1")).toBeUndefined()
  })

  it("does not start without a completed turn", async () => {
    const create = vi.fn()
    const runner = createReviewRunner({
      source: () => ({
        id: "main",
        session: {
          header: { cwd: WORKSPACE, agentPreset: "bot-a" },
          snapshotEvents: () => [{ type: "turn/start", seq: 0 }],
          requestHeader: () => ({ config: { provider: "p", model: "m" } }),
        },
      }),
      kind: () => "main",
      reviews: createReviewSessions(),
      newId: () => "review-1",
      create,
      later: () => () => {},
      limitMs: 1000,
    })
    await runner.run("a", "main")
    expect(create).not.toHaveBeenCalled()
  })

  it("tells the review it may only use skill_manage, and to reply NO_REPLY when nothing meets the bar", () => {
    expect(REVIEW_PROMPT).toContain("Only skill_manage runs here")
    expect(REVIEW_PROMPT).toContain("reply with exactly NO_REPLY")
    expect(REVIEW_PROMPT).toContain("Skill authoring standard:")
  })
})
