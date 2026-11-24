import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { SkillsClient } from "../src/client/skills/client"
import { diffLines, fileChanges } from "../src/client/skills/diff"
import { skillVersion } from "../src/client/skills/model"
import { skillDetail, skillsPageOf, versionDetail } from "../src/client/skills/pages"
import { retentionOf, SkillsSection } from "../src/client/skills/SkillsSection"
import type { BotSkillsView, SkillVersion } from "../src/shared/skills"
import { bot, t, value } from "./support/client"

const VIEW: BotSkillsView = {
  botId: "a",
  review: true,
  curator: true,
  library: {
    state: "ready",
    skills: [
      {
        name: "weekly-report",
        description: "When the owner asks for the weekly report.",
        archived: false,
        keep: false,
        retention: { kind: "unused", archivesAt: Date.now() + 12 * 86_400_000 },
        uses: 3,
        lastUsedAt: 1,
        versions: 2,
      },
      {
        name: "old-way",
        description: "Merged.",
        archived: true,
        keep: true,
        uses: 0,
        versions: 1,
      },
    ],
    invalid: [
      { path: "skills/flat.md", problem: "a skill is a directory <name>/ holding SKILL.md" },
    ],
  },
}

const VERSIONS: Record<string, SkillVersion> = {
  v2: {
    id: "v2",
    at: 2,
    operation: "patch",
    reason: "shorter",
    origin: { kind: "curator" },
    archived: false,
    files: [{ path: "SKILL.md", text: "---\nname: weekly-report\n---\nDo it.\n" }],
  },
  v1: {
    id: "v1",
    at: 1,
    operation: "create",
    origin: { kind: "conversation", sessionId: "main" },
    archived: false,
    files: [{ path: "SKILL.md", text: "---\nname: weekly-report\n---\nDo the thing.\n" }],
  },
}

const summary = ({ files: _files, ...rest }: SkillVersion) => rest

function client(view: BotSkillsView = VIEW): SkillsClient {
  return {
    bot: () => value({ status: "ready", value: view }),
    history: async (_botId, name) => ({
      name,
      versions: [summary(VERSIONS.v2 as SkillVersion), summary(VERSIONS.v1 as SkillVersion)],
    }),
    version: async (_botId, _name, id) => VERSIONS[id] as SkillVersion,
    restoreVersion: async (_botId, name) => ({ name, versions: [] }),
    restoreArchived: async (_botId, name) => ({ name, versions: [] }),
    setReview: async () => view,
    setCurator: async () => view,
    setKeep: async () => view,
  }
}

const frame = (detail: string | null) => ({
  t,
  bot: bot("a", "m-a"),
  page: { detail, open() {}, back() {} },
  close() {},
  confirm: async () => true,
})

describe("a skill's changes", () => {
  it("diffs lines and files against the version before", () => {
    expect(diffLines("a\nb\nc\n", "a\nx\nc\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ])
    expect(
      fileChanges(
        [
          { path: "SKILL.md", text: "a" },
          { path: "references/x.md", text: "x" },
        ],
        [
          { path: "templates/t.md", text: "t" },
          { path: "SKILL.md", text: "a" },
        ],
      ).map((change) => [change.path, change.kind]),
    ).toEqual([
      ["SKILL.md", "same"],
      ["references/x.md", "removed"],
      ["templates/t.md", "added"],
    ])
  })

  it("names its pages by skill and version", () => {
    expect(skillsPageOf(null)).toEqual({ kind: "list" })
    expect(skillsPageOf(skillDetail("weekly-report"))).toEqual({
      kind: "skill",
      name: "weekly-report",
    })
    expect(skillsPageOf(versionDetail("weekly-report", "v-1"))).toEqual({
      kind: "version",
      name: "weekly-report",
      versionId: "v-1",
    })
  })

  it("loads a version with the one before it", async () => {
    const feed = skillVersion(client(), "a", "weekly-report", "v2")
    const off = feed.subscribe(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    const state = feed.getSnapshot()
    expect(state.status === "ready" && state.value.previous).toBe("v1")
    expect(state.status === "ready" && state.value.newest).toBe(true)
    expect(
      state.status === "ready" && state.value.changes[0]?.lines.map((line) => line.kind),
    ).toContain("added")
    off()
  })
})

describe("the Skills section", () => {
  it("lists the review switch, the skills with their use, the archived ones and what is not loaded", () => {
    const html = renderToStaticMarkup(
      createElement(SkillsSection, { ...frame(null), skills: client() }),
    )
    expect(html).toContain('data-dshb-skills-review=""')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('data-dshb-skill="weekly-report"')
    expect(html).toContain("skills.uses.other(3)")
    expect(html).toContain('data-dshb-skills-archived=""')
    expect(html).toContain("skills.neverUsed")
    expect(html).toContain("skills/flat.md")
  })

  it("shows an empty bot and an environment it cannot read", () => {
    const empty = renderToStaticMarkup(
      createElement(SkillsSection, {
        ...frame(null),
        skills: client({ ...VIEW, library: { state: "ready", skills: [], invalid: [] } }),
      }),
    )
    expect(empty).toContain('data-dshb-skills-none=""')
    const down = renderToStaticMarkup(
      createElement(SkillsSection, {
        ...frame(null),
        skills: client({ ...VIEW, library: { state: "unavailable", message: "VM down" } }),
      }),
    )
    expect(down).toContain("skills.unavailable(VM down)")
  })

  it("offers to restore an archived skill on its page", () => {
    const html = renderToStaticMarkup(
      createElement(SkillsSection, { ...frame(skillDetail("old-way")), skills: client() }),
    )
    expect(html).toContain('data-dshb-skill-page="old-way"')
    expect(html).toContain('data-dshb-skill-restore=""')
    const active = renderToStaticMarkup(
      createElement(SkillsSection, { ...frame(skillDetail("weekly-report")), skills: client() }),
    )
    expect(active).not.toContain("data-dshb-skill-restore=")
  })
})

describe("the Skills section's tidy-up", () => {
  it("puts the tidy-up switch beside the review's, and a keep mark and its menu on each skill", () => {
    const html = renderToStaticMarkup(
      createElement(SkillsSection, { ...frame(null), skills: client() }),
    )
    expect(html).toContain('data-dshb-skills-curator=""')
    expect(html).toContain("skills.curator")
    expect(html).toContain("skills.archivesIn.other(12)")
    expect(html).toContain('data-dshb-skill-menu="weekly-report"')
    expect(html).toMatch(/data-dshb-skill="old-way"[^>]*data-dshb-skill-keep=""/)
  })

  it("says when a skill is archived, or what keeps it", () => {
    const now = 1_000_000_000
    const day = 86_400_000
    expect(retentionOf(t, { kind: "unused", archivesAt: now + day + 1 }, now)).toBe(
      "skills.archivesIn.other(2)",
    )
    expect(retentionOf(t, { kind: "unused", archivesAt: now - 1 }, now)).toBe("skills.archivesSoon")
    expect(retentionOf(t, { kind: "scheduled" }, now)).toBe("skills.scheduled")
    expect(retentionOf(t, { kind: "kept" }, now)).toBeUndefined()
    expect(retentionOf(t, { kind: "unseen" }, now)).toBeUndefined()
  })

  it("switches keep on a skill's page, and names the tidy-up as a version's origin", () => {
    const html = renderToStaticMarkup(
      createElement(SkillsSection, { ...frame(skillDetail("weekly-report")), skills: client() }),
    )
    expect(html).toContain('data-dshb-skill-keep-switch=""')
    expect(html).toContain("skills.keep")
  })
})
