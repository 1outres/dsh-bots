import type {
  ConnectorActionStatus,
  ConnectorActionView,
  ConnectorDecisionRecord,
  ConnectorJson,
} from "../../shared/connectors"

/** What the Actions panel shows of a bot's actions. */
export interface ActionsView {
  /** Pending, approved and running actions, oldest first: they are decided in order. */
  readonly open: readonly ConnectorActionView[]
  /** Every ended action the ledger keeps, newest first. */
  readonly history: readonly ConnectorActionView[]
  /** How many wait for a decision. */
  readonly pending: number
}

const OPEN_STATES: ReadonlySet<ConnectorActionStatus["state"]> = new Set([
  "pending",
  "approved",
  "executing",
])

export function isOpenStatus(status: ConnectorActionStatus): boolean {
  return OPEN_STATES.has(status.state)
}

/** When the action ended; undefined while it is open. */
export function endedAt(status: ConnectorActionStatus): number | undefined {
  switch (status.state) {
    case "pending":
    case "approved":
    case "executing":
      return undefined
    case "rejected":
      return status.decision.at
    default:
      return status.finishedAt
  }
}

const newestFirst = (a: ConnectorActionView, b: ConnectorActionView) =>
  (endedAt(b.status) ?? 0) - (endedAt(a.status) ?? 0)

export function actionsViewOf(actions: readonly ConnectorActionView[]): ActionsView {
  const open = actions.filter((action) => isOpenStatus(action.status))
  return {
    open,
    history: actions.filter((action) => !isOpenStatus(action.status)).sort(newestFirst),
    pending: pendingCount(actions),
  }
}

export function pendingCount(actions: readonly ConnectorActionView[]): number {
  return actions.filter((action) => action.status.state === "pending").length
}

export type ActionTone = "warning" | "busy" | "success" | "danger" | "idle"

/** The status pill's tone of an action's state. */
export function actionTone(status: ConnectorActionStatus): ActionTone {
  switch (status.state) {
    case "pending":
      return "warning"
    case "approved":
    case "executing":
      return "busy"
    case "succeeded":
      return "success"
    case "failed":
    case "interrupted":
      return "danger"
    case "rejected":
    case "expired":
    case "cancelled":
      return "idle"
  }
}

/** The decision an action carries, if it was decided. */
export function decisionOf(status: ConnectorActionStatus): ConnectorDecisionRecord | undefined {
  return "decision" in status ? status.decision : undefined
}

/** Who decided in a channel, worded; undefined for a decision from the Web UI, which goes without saying. */
export function deciderOf(
  decision: ConnectorDecisionRecord,
): { readonly key: string; readonly params: Readonly<Record<string, string>> } | undefined {
  const { origin } = decision
  return origin.kind === "web"
    ? undefined
    : {
        key: `approvals.by.channel.${decision.decision}`,
        params: { channel: origin.channelName, person: origin.person },
      }
}

/** A succeeded action's result as text: its text, else its data as JSON; undefined when it had neither. */
export function resultText(text: string | undefined, result: ConnectorJson): string | undefined {
  if (text !== undefined) return text
  return result === null ? undefined : JSON.stringify(result, null, 2)
}

/** Longest body shown before "Show all". */
export const BODY_PREVIEW_CHARS = 600
/** Most lines of a body shown before "Show all". */
export const BODY_PREVIEW_LINES = 12

/** A body's folded form, or undefined when it shows whole. */
export function foldBody(body: string): string | undefined {
  const lines = body.split("\n")
  if (body.length <= BODY_PREVIEW_CHARS && lines.length <= BODY_PREVIEW_LINES) return undefined
  const head = lines.slice(0, BODY_PREVIEW_LINES).join("\n")
  return head.length > BODY_PREVIEW_CHARS ? head.slice(0, BODY_PREVIEW_CHARS) : head
}
