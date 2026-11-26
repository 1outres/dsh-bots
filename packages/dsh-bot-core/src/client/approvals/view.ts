import type {
  ConnectorActionStatus,
  ConnectorActionView,
  ConnectorDecisionRecord,
  ConnectorJson,
} from "../../shared/connectors"

export interface ActionsView {
  readonly open: readonly ConnectorActionView[]
  readonly history: readonly ConnectorActionView[]
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

export function decisionOf(status: ConnectorActionStatus): ConnectorDecisionRecord | undefined {
  return "decision" in status ? status.decision : undefined
}

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

export function resultText(text: string | undefined, result: ConnectorJson): string | undefined {
  if (text !== undefined) return text
  return result === null ? undefined : JSON.stringify(result, null, 2)
}

export const BODY_PREVIEW_CHARS = 600
export const BODY_PREVIEW_LINES = 12

export function foldBody(body: string): string | undefined {
  const lines = body.split("\n")
  if (body.length <= BODY_PREVIEW_CHARS && lines.length <= BODY_PREVIEW_LINES) return undefined
  const head = lines.slice(0, BODY_PREVIEW_LINES).join("\n")
  return head.length > BODY_PREVIEW_CHARS ? head.slice(0, BODY_PREVIEW_CHARS) : head
}
