import {
  createMainController,
  type MainAgentState,
  type MainBot,
} from "../src/host/mains/controller"
import { createMainPreparations } from "../src/host/mains/preparations"
import { openMainStore } from "../src/host/mains/store"
import type { MainTurnPrompt, MainTurnResult } from "../src/mains-contract"
import { memoryTable } from "./channels-support"
import { manualClock } from "./connectors-support"

export const MINUTE = 60_000
export const NOON = Date.parse("2026-11-24T12:00:00+09:00")

export class NotReady extends Error {}

export async function mainControllerSetup() {
  const clock = manualClock(NOON)
  const store = await openMainStore({
    mainSettings: memoryTable(),
    mainOverrides: memoryTable(),
    mainActivity: memoryTable(),
  })
  const bot: { current: MainBot } = {
    current: { id: "b", name: "Bot", timezone: "Asia/Tokyo", mainSessionId: "m1" },
  }
  const agents = new Map<string, MainAgentState>()
  const idle: MainAgentState = { status: "idle", inboxEmpty: true, usagePercent: 10 }
  const log: string[] = []
  const warnings: string[] = []
  const prompts: MainTurnPrompt[] = []
  const state: {
    interactions: number
    sessions: number
    notReady: boolean
    compacted: boolean
    turn: () => Promise<MainTurnResult>
  } = {
    interactions: 0,
    sessions: 1,
    notReady: false,
    compacted: true,
    turn: async () => ({ ended: "completed" }),
  }
  const deadline = { controller: new AbortController() }
  const preparations = createMainPreparations()
  const controller = createMainController({
    bot: (botId) => (botId === "b" ? bot.current : undefined),
    bots: () => [bot.current],
    store,
    agentOf: (sessionId) => agents.get(sessionId),
    resolve: async (sessionId) => agents.get(sessionId) ?? idle,
    openInteractions: () => state.interactions,
    async compact(_botId, sessionId) {
      log.push(`compact ${sessionId}`)
      return state.compacted
    },
    async createMain(botId, title) {
      if (state.notReady) throw new NotReady("preset not ready")
      state.sessions += 1
      log.push(`create ${botId} ${title}`)
      return `m${state.sessions}`
    },
    async replaceMain(_botId, expected, next, reason) {
      log.push(`replace ${expected} ${next} ${reason}`)
      bot.current = { ...bot.current, mainSessionId: next }
    },
    async archive(sessionId) {
      log.push(`archive ${sessionId}`)
    },
    mainChanged: (botId) => log.push(`changed ${botId}`),
    preparations,
    runTurn(sessionId, prompt) {
      log.push(`turn ${sessionId} ${prompt.summary}`)
      prompts.push(prompt)
      return state.turn()
    },
    now: clock.now,
    later: clock.later,
    deadline: () => {
      deadline.controller = new AbortController()
      return deadline.controller.signal
    },
    notReady: (error) => error instanceof NotReady,
    maintenanceLimitMs: 5 * MINUTE,
    retry: { initialMs: 5 * MINUTE, maxMs: 20 * MINUTE },
    warn: (message) => warnings.push(message),
  })
  return {
    clock,
    store,
    bot,
    agents,
    log,
    warnings,
    prompts,
    state,
    deadline,
    preparations,
    controller,
  }
}
