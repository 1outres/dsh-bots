import type { CurationOutcome } from "./curation-run"
import { DAY_MS } from "./retention"
import type { SkillStore } from "./store"
import { SLIM_BYTES } from "./texts"

export const SWEEP_EVERY_MS = DAY_MS
export const CURATION_EVERY_MS = 7 * DAY_MS
export const CURATION_QUIET_MS = 30_000
export const CURATION_RETRY_MS = 60 * 60_000
export const CURATION_MIN_SKILLS = 2

export function calledForCuration(skills: readonly { readonly bytes: number }[]): boolean {
  return skills.length >= CURATION_MIN_SKILLS || skills.some((skill) => skill.bytes > SLIM_BYTES)
}

export type SweepOutcome = "swept" | "unavailable"

export interface SkillCurationDeps {
  bots(): readonly string[]
  store: Pick<SkillStore, "curation" | "markSwept" | "markCurated" | "curatorEnabled">
  sweep(botId: string): Promise<SweepOutcome>
  skills(botId: string): Promise<readonly { readonly bytes: number }[] | undefined>
  mainOf(botId: string): string | undefined
  idle(sessionId: string): boolean
  curate(botId: string): Promise<CurationOutcome>
  now(): number
  later(ms: number, work: () => void): () => void
  readonly maxDelayMs: number
  warn(message: string): void
}

export interface SkillCuration {
  sync(botId?: string): void
  activity(sessionId: string): void
  dispose(): void
}

interface Task {
  running: boolean
  heldUntil: number
}

interface BotState {
  readonly sweep: Task
  readonly curation: Task
  quiet: (() => void) | undefined
  awaitingIdle: boolean
}

export function createSkillCuration(deps: SkillCurationDeps): SkillCuration {
  const states = new Map<string, BotState>()
  let timer: (() => void) | undefined
  let disposed = false

  const stateOf = (botId: string): BotState => {
    let state = states.get(botId)
    if (state === undefined) {
      state = {
        sweep: { running: false, heldUntil: 0 },
        curation: { running: false, heldUntil: 0 },
        quiet: undefined,
        awaitingIdle: false,
      }
      states.set(botId, state)
    }
    return state
  }
  const dueAt = (last: number | undefined, every: number, task: Task) =>
    Math.max(last === undefined ? 0 : last + every, task.heldUntil)
  const sweepDueAt = (botId: string, state: BotState) =>
    dueAt(deps.store.curation(botId).sweptAt, SWEEP_EVERY_MS, state.sweep)
  const curationDueAt = (botId: string, state: BotState) =>
    dueAt(deps.store.curation(botId).curatedAt, CURATION_EVERY_MS, state.curation)
  const wantsCuration = (botId: string, state: BotState) =>
    !state.curation.running && deps.store.curatorEnabled(botId) && deps.mainOf(botId) !== undefined
  const stopQuiet = (state: BotState) => {
    state.quiet?.()
    state.quiet = undefined
    state.awaitingIdle = false
  }
  const hold = (task: Task) => {
    task.heldUntil = deps.now() + CURATION_RETRY_MS
  }
  const failed = (what: string, botId: string, error: unknown) => {
    deps.warn(`bot-core: the ${what} of bot "${botId}"'s skills failed: ${String(error)}`)
  }

  const startSweep = (botId: string, state: BotState) => {
    const at = deps.now()
    state.sweep.running = true
    deps
      .sweep(botId)
      .then(async (outcome) => {
        if (outcome === "swept") await deps.store.markSwept(botId, at)
        else hold(state.sweep)
      })
      .catch((error: unknown) => {
        failed("daily archive", botId, error)
        hold(state.sweep)
      })
      .finally(() => {
        state.sweep.running = false
        tick()
      })
  }

  const curate = async (botId: string, state: BotState) => {
    const at = deps.now()
    const skills = await deps.skills(botId)
    if (skills === undefined) {
      hold(state.curation)
      return
    }
    if (!calledForCuration(skills)) {
      state.curation.heldUntil = Number.POSITIVE_INFINITY
      return
    }
    const outcome = await deps.curate(botId)
    if (outcome.kind === "ran") await deps.store.markCurated(botId, at)
    else hold(state.curation)
  }

  const quietEnded = (botId: string, state: BotState) => {
    state.quiet = undefined
    if (disposed || !wantsCuration(botId, state) || curationDueAt(botId, state) > deps.now()) {
      tick()
      return
    }
    const main = deps.mainOf(botId)
    if (main === undefined) return
    if (!deps.idle(main)) {
      state.awaitingIdle = true
      return
    }
    state.curation.running = true
    curate(botId, state)
      .catch((error: unknown) => {
        failed("curation", botId, error)
        hold(state.curation)
      })
      .finally(() => {
        state.curation.running = false
        tick()
      })
  }

  const waitForQuiet = (botId: string, state: BotState) => {
    state.quiet?.()
    state.awaitingIdle = false
    state.quiet = deps.later(CURATION_QUIET_MS, () => quietEnded(botId, state))
  }

  const tick = () => {
    if (disposed) return
    timer?.()
    timer = undefined
    const now = deps.now()
    const bots = new Set(deps.bots())
    for (const [botId, state] of [...states]) {
      if (bots.has(botId)) continue
      stopQuiet(state)
      states.delete(botId)
    }
    let next = Number.POSITIVE_INFINITY
    for (const botId of bots) {
      const state = stateOf(botId)
      if (!state.sweep.running) {
        const at = sweepDueAt(botId, state)
        if (at <= now) startSweep(botId, state)
        else next = Math.min(next, at)
      }
      if (!wantsCuration(botId, state)) {
        if (!state.curation.running) stopQuiet(state)
        continue
      }
      if (state.quiet !== undefined || state.awaitingIdle) continue
      const at = curationDueAt(botId, state)
      if (at <= now) waitForQuiet(botId, state)
      else next = Math.min(next, at)
    }
    if (next === Number.POSITIVE_INFINITY) return
    timer = deps.later(Math.min(deps.maxDelayMs, Math.max(0, next - now)), () => {
      timer = undefined
      tick()
    })
  }

  return {
    sync(botId) {
      for (const [id, state] of states) {
        if (botId !== undefined && id !== botId) continue
        state.sweep.heldUntil = 0
        state.curation.heldUntil = 0
      }
      tick()
    },
    activity(sessionId) {
      for (const [botId, state] of states) {
        if (deps.mainOf(botId) !== sessionId) continue
        if (state.quiet !== undefined || state.awaitingIdle) waitForQuiet(botId, state)
      }
    },
    dispose() {
      disposed = true
      timer?.()
      timer = undefined
      for (const state of states.values()) stopQuiet(state)
      states.clear()
    },
  }
}
