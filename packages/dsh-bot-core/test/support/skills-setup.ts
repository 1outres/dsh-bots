import { createBotSkills } from "../../src/host/skills/bot-skills"
import { createCuratorSessions } from "../../src/host/skills/curation-run"
import { createSkillRetentions } from "../../src/host/skills/retention"
import { createReviewSessions } from "../../src/host/skills/review"
import { createSkillStore } from "../../src/host/skills/store"
import type { BotSessionKind } from "../../src/internal"
import { memorySkillsFs, memoryTable } from "./skills-fs"

export const WORKSPACE = "/home/bot/workspace"
export const signal = new AbortController().signal

export const skillMd = (
  name: string,
  description: string,
  body = "1. Do the thing.\n2. Check it.",
) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`

/** One bot "a" with sessions of each kind, and bot-core's skills over a file system in memory. */
export function setup() {
  const fs = memorySkillsFs()
  const place = { fs, workspace: WORKSPACE }
  const kinds: Record<string, BotSessionKind> = {
    main: "main",
    web: "web",
    run: "schedule",
    helper: "subagent",
  }
  const reviews = createReviewSessions()
  const curators = createCuratorSessions()
  const store = createSkillStore({
    skillHistory: memoryTable(),
    skillUsage: memoryTable(),
    skillSettings: memoryTable(),
    skillMarks: memoryTable(),
    skillCuration: memoryTable(),
  })
  const clock = { now: 1_700_000_000_000 }
  let ids = 0
  const stepped: string[] = []
  const skills = createBotSkills({
    sealed: (botId, token) => botId === "a" && token === "t",
    agent: (agentId) =>
      kinds[agentId] === undefined &&
      reviews.get(agentId) === undefined &&
      curators.get(agentId) === undefined
        ? undefined
        : {
            id: agentId,
            session: {
              header:
                kinds[agentId] === "subagent" || reviews.get(agentId) || curators.get(agentId)
                  ? { parentSession: "main" }
                  : {},
            },
          },
    botOf: () => "a",
    kind: {
      isMain: (_botId, sessionId) => sessionId === "main",
      isScheduleRun: (_botId, sessionId) => sessionId === "run",
      isRecorded: (_botId, sessionId) => sessionId === "web",
      isStartedByMain: () => false,
      reviewed: (botId, sessionId) => {
        const review = reviews.get(sessionId)
        return review?.botId === botId ? review.kind : undefined
      },
      curating: (botId, sessionId) => curators.get(sessionId)?.botId === botId,
    },
    reviews,
    placeOf: () => place,
    history: {
      store,
      newId: () => `v${++ids}`,
      now: () => (clock.now += 1000),
      day: () => "2026-11-24",
    },
    store,
    stepped: (_botId, sessionId) => stepped.push(sessionId),
    now: () => clock.now,
    warn: () => {},
  })
  const jobTexts: string[] = []
  const retentions = createSkillRetentions({ store, jobTexts: () => jobTexts })
  const manage = (agentId: string, args: object) =>
    skills.call("a", "t", { agentId, args }, signal).then((result) => result.text)
  const file = (path: string) => fs.files.get(`${WORKSPACE}/${path}`)?.text
  return {
    fs,
    place,
    store,
    skills,
    reviews,
    curators,
    retentions,
    jobTexts,
    clock,
    manage,
    file,
    stepped,
  }
}
