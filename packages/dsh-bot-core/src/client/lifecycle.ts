import type { BotsSnapshot, BotView, CreationPhase, PendingBotView } from "../shared/bots"
import { CREATION_PHASES } from "../shared/bots"

export type LifecycleEvent =
  | { readonly kind: "created"; readonly bot: BotView }
  | { readonly kind: "create-failed"; readonly pending: PendingBotView }
  | { readonly kind: "remove-failed"; readonly pending: PendingBotView }
  | { readonly kind: "gone"; readonly id: string; readonly operation: "create" | "remove" }

const failedNow = (before: PendingBotView | undefined, after: PendingBotView) =>
  after.failure !== undefined && before?.failure === undefined

export function lifecycleEvents(previous: BotsSnapshot, next: BotsSnapshot): LifecycleEvent[] {
  const before = new Map(previous.pending.map((pending) => [pending.id, pending]))
  const after = new Set(next.pending.map((pending) => pending.id))
  const events: LifecycleEvent[] = []
  for (const pending of next.pending) {
    if (!failedNow(before.get(pending.id), pending)) continue
    const kind = pending.operation.kind === "create" ? "create-failed" : "remove-failed"
    events.push({ kind, pending })
  }
  for (const [id, pending] of before) {
    if (after.has(id)) continue
    const bot = next.bots.find((listed) => listed.id === id)
    if (pending.operation.kind === "create" && bot !== undefined) {
      events.push({ kind: "created", bot })
    } else {
      events.push({ kind: "gone", id, operation: pending.operation.kind })
    }
  }
  return events
}

export function pendingOf(snapshot: BotsSnapshot, id: string): PendingBotView | undefined {
  return snapshot.pending.find((pending) => pending.id === id)
}

export type StepState = "done" | "current" | "failed" | "waiting"

export interface CreationStep {
  readonly phase: CreationPhase
  readonly state: StepState
}

function stepState(index: number, at: number, failed: boolean): StepState {
  if (index < at) return "done"
  if (index > at) return "waiting"
  return failed ? "failed" : "current"
}

export function creationSteps(phase: CreationPhase, failed: boolean): CreationStep[] {
  const at = CREATION_PHASES.indexOf(phase)
  return CREATION_PHASES.map((step, index) => ({
    phase: step,
    state: stepState(index, at, failed),
  }))
}

export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = String(total % 60).padStart(2, "0")
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}:${seconds}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${seconds}`
}
