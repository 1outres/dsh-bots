import type {
  ConnectorAction,
  ConnectorActionState,
  ConnectorActionStatus,
  ConnectorDecisionOrigin,
  ConnectorJson,
} from "../../shared/connectors"

export type ConnectorActionEvent =
  | { readonly kind: "approve"; readonly origin: ConnectorDecisionOrigin; readonly at: number }
  | { readonly kind: "reject"; readonly origin: ConnectorDecisionOrigin; readonly at: number }
  | { readonly kind: "expire"; readonly at: number }
  | { readonly kind: "cancel"; readonly at: number }
  | { readonly kind: "start"; readonly at: number }
  | {
      readonly kind: "succeed"
      readonly at: number
      readonly result: ConnectorJson
      readonly text?: string
    }
  | { readonly kind: "fail"; readonly at: number; readonly reason: string }
  | { readonly kind: "interrupt"; readonly at: number }

export type ConnectorActionTransition =
  | { readonly ok: true; readonly action: ConnectorAction }
  | { readonly ok: false; readonly from: ConnectorActionState }

function next(
  status: ConnectorActionStatus,
  event: ConnectorActionEvent,
): ConnectorActionStatus | undefined {
  switch (status.state) {
    case "pending":
      switch (event.kind) {
        case "approve":
          return {
            state: "approved",
            decision: { decision: "approve", origin: event.origin, at: event.at },
          }
        case "reject":
          return {
            state: "rejected",
            decision: { decision: "reject", origin: event.origin, at: event.at },
          }
        case "expire":
          return { state: "expired", finishedAt: event.at }
        case "cancel":
          return { state: "cancelled", finishedAt: event.at }
        default:
          return undefined
      }
    case "approved":
      switch (event.kind) {
        case "start":
          return { state: "executing", decision: status.decision, startedAt: event.at }
        case "fail":
          return {
            state: "failed",
            decision: status.decision,
            finishedAt: event.at,
            reason: event.reason,
          }
        default:
          return undefined
      }
    case "executing": {
      const { decision, startedAt } = status
      switch (event.kind) {
        case "succeed":
          return {
            state: "succeeded",
            decision,
            startedAt,
            finishedAt: event.at,
            result: event.result,
            ...(event.text === undefined ? {} : { text: event.text }),
          }
        case "fail":
          return {
            state: "failed",
            decision,
            startedAt,
            finishedAt: event.at,
            reason: event.reason,
          }
        case "interrupt":
          return { state: "interrupted", decision, startedAt, finishedAt: event.at }
        default:
          return undefined
      }
    }
    default:
      return undefined
  }
}

export function advance(
  action: ConnectorAction,
  event: ConnectorActionEvent,
): ConnectorActionTransition {
  const status = next(action.status, event)
  return status === undefined
    ? { ok: false, from: action.status.state }
    : { ok: true, action: { ...action, status } }
}

export function isOpen(action: ConnectorAction): boolean {
  const { state } = action.status
  return state === "pending" || state === "approved" || state === "executing"
}

export function finishedAt(action: ConnectorAction): number | undefined {
  const { status } = action
  switch (status.state) {
    case "succeeded":
    case "failed":
    case "interrupted":
    case "expired":
    case "cancelled":
      return status.finishedAt
    case "rejected":
      return status.decision.at
    default:
      return undefined
  }
}

export function canonicalJson(value: ConnectorJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  const record = value as { readonly [key: string]: ConnectorJson }
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as ConnectorJson)}`)
  return `{${fields.join(",")}}`
}
