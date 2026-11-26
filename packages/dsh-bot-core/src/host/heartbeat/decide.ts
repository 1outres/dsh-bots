import { hasHeartbeatTasks } from "./tasks"

export interface HeartbeatWaiting {
  readonly connector: { readonly id: string; readonly name: string }
  readonly account: string
  readonly count: number
}

export type HeartbeatFile =
  | { readonly kind: "absent" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "too-large"; readonly bytes: number }

export type HeartbeatFileRead =
  | HeartbeatFile
  | { readonly kind: "unavailable"; readonly reason: string }

export type HeartbeatTasks = Exclude<HeartbeatFile, { readonly kind: "absent" }>

export type BeatDecision =
  | { readonly kind: "nothing" }
  | {
      readonly kind: "send"
      readonly waiting: readonly HeartbeatWaiting[]
      readonly tasks: HeartbeatTasks | undefined
    }

const NOTHING: BeatDecision = { kind: "nothing" }

function tasksOf(file: HeartbeatFile): HeartbeatTasks | undefined {
  switch (file.kind) {
    case "absent":
      return undefined
    case "too-large":
      return file
    case "text":
      return hasHeartbeatTasks(file.text) ? file : undefined
  }
}

export function decideBeat(
  waiting: readonly HeartbeatWaiting[],
  file: HeartbeatFile,
): BeatDecision {
  const counted = waiting.filter((entry) => entry.count > 0)
  const tasks = tasksOf(file)
  if (counted.length === 0 && tasks === undefined) return NOTHING
  return { kind: "send", waiting: counted, tasks }
}
