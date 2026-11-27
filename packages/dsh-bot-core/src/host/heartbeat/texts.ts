import { formatLocal } from "../schedule/timing"
import type { HeartbeatTasks, HeartbeatWaiting } from "./decide"
import { HEARTBEAT_FILE, MAX_HEARTBEAT_BYTES } from "./file"

export interface HeartbeatNoticeInput {
  readonly at: number
  readonly timezone: string
  readonly waiting: readonly HeartbeatWaiting[]
  readonly tasks: HeartbeatTasks | undefined
}

const FENCE = "heartbeat-file"

function waitingLines(waiting: readonly HeartbeatWaiting[]): string[] {
  if (waiting.length === 0) return []
  return [
    "Connector events waiting for you:",
    ...waiting.map((entry) => `- ${entry.connector.name} (${entry.account}): ${entry.count}`),
  ]
}

function taskLines(tasks: HeartbeatTasks | undefined): string[] {
  if (tasks === undefined) return []
  if (tasks.kind === "too-large") {
    return [
      `${HEARTBEAT_FILE} has ${tasks.bytes} bytes, more than the ${MAX_HEARTBEAT_BYTES} the heartbeat reads: read it from your workspace yourself, and shorten it.`,
    ]
  }
  return [`${HEARTBEAT_FILE}:`, `<<<${FENCE}`, tasks.text.trimEnd(), `>>>${FENCE}`]
}

function instructions(input: HeartbeatNoticeInput): string[] {
  return [
    ...(input.waiting.length === 0
      ? []
      : [
          "- Read the waiting events with the matching _events_list tool (pass the account) and do what your owner would want with them.",
          "- Then acknowledge every event you looked at with the matching _events_ack tool, the ones you chose to leave alone too: events you do not acknowledge bring the heartbeat back every time.",
        ]),
    ...(input.tasks === undefined ? [] : [`- Follow ${HEARTBEAT_FILE}.`]),
    "- Do not bring back tasks from earlier conversations, and do not invent work.",
    "- If there is nothing to tell your owner, end the turn with stay_silent instead of writing anything.",
  ]
}

function summaryOf(input: HeartbeatNoticeInput): string {
  const count = input.waiting.reduce((total, entry) => total + entry.count, 0)
  const parts = [
    ...(count === 0 ? [] : [`${count} event${count === 1 ? "" : "s"} waiting`]),
    ...(input.tasks === undefined ? [] : [HEARTBEAT_FILE]),
  ]
  return `Heartbeat: ${parts.join(", ")}`
}

export function heartbeatNotice(input: HeartbeatNoticeInput): {
  readonly text: string
  readonly summary: string
} {
  return {
    text: [
      `[heartbeat] ${formatLocal(input.at, input.timezone)}`,
      "This is your periodic heartbeat, not a message from a person.",
      ...waitingLines(input.waiting),
      ...taskLines(input.tasks),
      ...instructions(input),
    ].join("\n"),
    summary: summaryOf(input),
  }
}
