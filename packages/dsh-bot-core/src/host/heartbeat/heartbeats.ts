import type {
  HeartbeatLastBeat,
  HeartbeatOutcome,
  HeartbeatSettings,
  HeartbeatStatus,
} from "../../shared/heartbeat"
import { decideBeat, type HeartbeatFileRead, type HeartbeatWaiting } from "./decide"
import { heartbeatNotice } from "./texts"
import { nextBeatAt, withinActiveHours } from "./timing"

export interface HeartbeatsDeps {
  bots(): readonly string[]
  settings(botId: string): HeartbeatSettings
  timezone(botId: string): string
  idle(botId: string): boolean
  waiting(botId: string): readonly HeartbeatWaiting[]
  read(botId: string): Promise<HeartbeatFileRead>
  enqueue(botId: string, notice: { readonly text: string; readonly summary: string }): Promise<void>
  now(): number
  later(ms: number, work: () => void): () => void
  readonly maxDelayMs: number
  warn(message: string): void
}

export interface Heartbeats {
  sync(botId?: string): void
  nudge(botId: string): void
  nudgeAll(): void
  status(botId: string): HeartbeatStatus
  subscribe(listener: (botId: string) => void): () => void
  dispose(): void
}

interface BotBeat {
  cancel: (() => void) | undefined
  next: number | undefined
  pending: boolean
  running: boolean
  again: boolean
  last: HeartbeatLastBeat | undefined
}

const IDLE_STATUS: HeartbeatStatus = { pending: false }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createHeartbeats(deps: HeartbeatsDeps): Heartbeats {
  const beats = new Map<string, BotBeat>()
  const listeners = new Set<(botId: string) => void>()
  let disposed = false

  const publish = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  const beatOf = (botId: string): BotBeat => {
    let beat = beats.get(botId)
    if (beat === undefined) {
      beat = {
        cancel: undefined,
        next: undefined,
        pending: false,
        running: false,
        again: false,
        last: undefined,
      }
      beats.set(botId, beat)
    }
    return beat
  }
  const finish = (botId: string, beat: BotBeat, outcome: HeartbeatOutcome) => {
    beat.pending = false
    beat.last = { at: deps.now(), outcome }
    publish(botId)
  }

  const run = async (botId: string, beat: BotBeat) => {
    const settings = deps.settings(botId)
    if (!settings.enabled) {
      beat.pending = false
      return
    }
    const timezone = deps.timezone(botId)
    if (!withinActiveHours(settings.activeHours, deps.now(), timezone)) {
      finish(botId, beat, "outside-hours")
      return
    }
    const file = await deps.read(botId)
    if (file.kind === "unavailable") {
      deps.warn(`bot-core: the heartbeat of bot "${botId}" waits: ${file.reason}`)
      return
    }
    if (disposed || !beat.pending || !deps.idle(botId)) return
    const decision = decideBeat(deps.waiting(botId), file)
    if (decision.kind === "nothing") {
      finish(botId, beat, "nothing")
      return
    }
    await deps.enqueue(
      botId,
      heartbeatNotice({
        at: deps.now(),
        timezone,
        waiting: decision.waiting,
        tasks: decision.tasks,
      }),
    )
    finish(botId, beat, "sent")
  }

  const attempt = (botId: string) => {
    const beat = beats.get(botId)
    if (disposed || beat === undefined || !beat.pending) return
    if (beat.running) {
      beat.again = true
      return
    }
    if (!deps.idle(botId)) return
    beat.running = true
    beat.again = false
    run(botId, beat)
      .catch((error: unknown) => {
        deps.warn(`bot-core: the heartbeat of bot "${botId}" failed: ${messageOf(error)}`)
      })
      .finally(() => {
        beat.running = false
        if (beat.again) attempt(botId)
      })
  }

  const arm = (botId: string) => {
    const beat = beatOf(botId)
    beat.cancel?.()
    beat.cancel = undefined
    const settings = deps.settings(botId)
    if (!settings.enabled) beat.pending = false
    let next: number | undefined
    try {
      next = nextBeatAt(settings, deps.timezone(botId), deps.now())
    } catch (error) {
      deps.warn(`bot-core: the heartbeat of bot "${botId}" cannot be timed: ${messageOf(error)}`)
    }
    beat.next = next
    if (next !== undefined && !disposed) {
      const due = next
      beat.cancel = deps.later(Math.min(deps.maxDelayMs, Math.max(0, due - deps.now())), () => {
        beat.cancel = undefined
        if (deps.now() >= due) beat.pending = true
        arm(botId)
        attempt(botId)
      })
    }
    publish(botId)
  }

  const forget = (botId: string) => {
    beats.get(botId)?.cancel?.()
    beats.delete(botId)
  }

  return {
    sync(botId) {
      if (disposed) return
      const known = new Set(deps.bots())
      if (botId !== undefined) {
        if (known.has(botId)) arm(botId)
        else forget(botId)
        return
      }
      for (const id of [...beats.keys()]) if (!known.has(id)) forget(id)
      for (const id of known) arm(id)
    },
    nudge: attempt,
    nudgeAll() {
      for (const botId of [...beats.keys()]) attempt(botId)
    },
    status(botId) {
      const beat = beats.get(botId)
      if (beat === undefined) return IDLE_STATUS
      return {
        ...(beat.next === undefined ? {} : { next: beat.next }),
        pending: beat.pending,
        ...(beat.last === undefined ? {} : { last: beat.last }),
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      for (const beat of beats.values()) beat.cancel?.()
      beats.clear()
      listeners.clear()
    },
  }
}
