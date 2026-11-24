import type { ConnectorAction, ConnectorJson } from "../../shared/connectors"
import { connectorToolName } from "../../shared/connectors"
import type { ToolOutput } from "./execution"
import type { ImageRef } from "./images"

/** The frame every connector notice's text starts with (the message source is not shown to the model). */
export const NOTICE_FRAME = "[BOT CONNECTOR NOTICE]"

/** Longest notice summary (DSH's CONTEXT_SUMMARY_MAX_CHARS). */
const MAX_SUMMARY = 120

/** What a connector tool call returns to the bot: the text the model reads, the same as data, and images. */
export interface ConnectorToolReply {
  readonly text: string
  readonly data: ConnectorJson
  readonly images?: readonly ImageRef[]
}

const iso = (at: number) => new Date(at).toISOString()
const json = (value: ConnectorJson) => JSON.stringify(value, null, 2)
const nameOf = (action: ConnectorAction) => connectorToolName(action.connectorId, action.tool)
const label = (action: ConnectorAction) =>
  `action ${action.id} (${nameOf(action)}: ${action.preview.title})`

/** A result's text and data as the model reads them. */
function resultText(text: string | undefined, data: ConnectorJson): string {
  return [text ?? "", data === null ? "" : `Result:\n${json(data)}`]
    .filter((part) => part !== "")
    .join("\n\n")
}

export function doneReply(tool: string, output: ToolOutput): ConnectorToolReply {
  const body = resultText(output.text, output.data)
  return {
    text: body === "" ? `${tool} ran.` : body,
    data: { status: "done", result: output.data },
    ...(output.images.length === 0 ? {} : { images: output.images }),
  }
}

/** The reply of a call whose action is still waiting for a decision. */
export function awaitingReply(action: ConnectorAction): ConnectorToolReply {
  return {
    text: [
      `Awaiting the user's approval: ${label(action)} was not run yet.`,
      `It stays pending until ${iso(action.expiresAt)} (action id ${action.id}).`,
      "Do not call the tool again for this request: the call is kept, and its result will reach you later as a",
      `${NOTICE_FRAME} message. Do not go on with work that depends on its result. Tell the user that it is`,
      "waiting for their approval.",
    ].join(" "),
    data: { status: "awaiting-approval", actionId: action.id, expiresAt: iso(action.expiresAt) },
  }
}

/** The reply of a call whose action ended while the call waited for it. */
export function endedReply(action: ConnectorAction): ConnectorToolReply {
  const { status } = action
  const base = { actionId: action.id, state: status.state }
  switch (status.state) {
    case "succeeded":
      return {
        text: [
          `The user approved ${label(action)} and it ran.`,
          resultText(status.text, status.result),
        ]
          .filter((part) => part !== "")
          .join("\n\n"),
        data: { ...base, result: status.result },
      }
    case "failed":
      return {
        text: `The user approved ${label(action)}, but it failed: ${status.reason}`,
        data: { ...base, reason: status.reason },
      }
    case "interrupted":
      return {
        text: `The user approved ${label(action)}, but DeepSeek Harness stopped while it ran: it is unknown whether it took effect. Do not run it again; tell the user so they can check.`,
        data: base,
      }
    case "rejected":
      return {
        text: `The user rejected ${label(action)}. It did not run. Do not try it again unless the user asks.`,
        data: base,
      }
    case "expired":
      return { text: `${label(action)} expired without a decision. It did not run.`, data: base }
    case "cancelled":
      return { text: `${label(action)} was cancelled. It did not run.`, data: base }
    default:
      return awaitingReply(action)
  }
}

/** A notice to the bot's Main session about an action that ended after its call returned. */
export interface ConnectorNotice {
  readonly text: string
  readonly summary: string
}

function summary(action: ConnectorAction, outcome: string): string {
  const line = `${nameOf(action)} ${outcome}: ${action.preview.title}`
  return line.length <= MAX_SUMMARY ? line : `${line.slice(0, MAX_SUMMARY - 1)}…`
}

/** The notice of an ended action, or undefined when it needs none (the bot cancelled it). */
export function endedNotice(action: ConnectorAction): ConnectorNotice | undefined {
  const { status } = action
  const intro = `${NOTICE_FRAME} Your connector call that was awaiting approval has ended: ${label(action)}.`
  const lines = (...rest: string[]) => [intro, ...rest].join("\n\n")
  switch (status.state) {
    case "succeeded":
      return {
        text: lines(
          "The user approved it, and it ran with the arguments of your call.",
          resultText(status.text, status.result) || "It returned nothing.",
          "Continue the work that waited for it, and tell the user how it went.",
        ),
        summary: summary(action, "approved and ran"),
      }
    case "failed":
      return {
        text: lines(
          "The user approved it, but it failed:",
          status.reason,
          "Tell the user. Call the tool again only if the user asks.",
        ),
        summary: summary(action, "approved, failed"),
      }
    case "interrupted":
      return {
        text: lines(
          "The user approved it, but DeepSeek Harness stopped while it ran, so it is unknown whether it took effect. It was not run again.",
          "Tell the user so they can check, and do not run it again unless they ask.",
        ),
        summary: summary(action, "interrupted"),
      }
    case "rejected":
      return {
        text: lines(
          "The user rejected it. It did not run.",
          "Do not try it again unless the user asks; tell them you will not do it.",
        ),
        summary: summary(action, "rejected"),
      }
    case "expired":
      return {
        text: lines(
          `Nobody decided it before ${iso(action.expiresAt)}, so it expired. It did not run.`,
          "Tell the user; call the tool again only if they still want it.",
        ),
        summary: summary(action, "expired"),
      }
    default:
      return undefined
  }
}

/** One line per action, for connector_pending_list. */
export function pendingListReply(actions: readonly ConnectorAction[]): ConnectorToolReply {
  const rows = actions.map((action) => ({
    actionId: action.id,
    tool: nameOf(action),
    title: action.preview.title,
    state: action.status.state,
    createdAt: iso(action.createdAt),
    expiresAt: iso(action.expiresAt),
  }))
  return {
    text:
      rows.length === 0
        ? "No connector action is awaiting approval or running."
        : rows
            .map(
              (row) =>
                `- ${row.actionId}: ${row.tool} "${row.title}" — ${row.state} (created ${row.createdAt}, pending until ${row.expiresAt})`,
            )
            .join("\n"),
    data: { actions: rows },
  }
}

export function cancelledReply(action: ConnectorAction): ConnectorToolReply {
  return {
    text: `Cancelled ${label(action)}. It will not run, and no notice will follow.`,
    data: { actionId: action.id, state: "cancelled" },
  }
}
