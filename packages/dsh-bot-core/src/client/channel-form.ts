import type {
  BotChannelChange,
  BotChannelListField,
  BotChannelTextField,
  BotChannelView,
} from "../shared/channels"
import type { PillTone } from "./ui/StatusPill"

/** One change made in a channel's settings, saved at once. */
export type ChannelEdit =
  | { readonly kind: "enabled"; readonly enabled: boolean }
  | { readonly kind: "value"; readonly key: string; readonly value: string | readonly string[] }
  | { readonly kind: "secret"; readonly key: string; readonly secret: string | null }

/** The whole change a channel's `configure` takes: what is stored, with `edit` applied; other secrets kept. */
export function changeWith(view: BotChannelView, edit: ChannelEdit): BotChannelChange {
  const values: Record<string, string | readonly string[]> = {}
  for (const field of view.channel.fields) {
    const stored = view.values[field.key]
    if (field.kind === "text" || field.kind === "pick")
      values[field.key] = typeof stored === "string" ? stored : ""
    if (field.kind === "list") values[field.key] = Array.isArray(stored) ? stored : []
  }
  if (edit.kind === "value") {
    const field = view.channel.fields.find((known) => known.key === edit.key)
    if (field?.kind === "pick" && values[edit.key] !== edit.value) {
      for (const key of field.clears ?? []) {
        const cleared = view.channel.fields.find((known) => known.key === key)
        values[key] = cleared?.kind === "list" ? [] : ""
      }
    }
    values[edit.key] = edit.value
  }
  return {
    enabled: edit.kind === "enabled" ? edit.enabled : view.enabled,
    values,
    secrets:
      edit.kind === "secret"
        ? {
            [edit.key]:
              edit.secret === null ? { op: "clear" } : { op: "set", value: edit.secret.trim() },
          }
        : {},
  }
}

/** A list field's items as typed: split by line or comma, blanks dropped. */
export function listItemsOf(text: string): readonly string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/** A list field's stored items, one per line. */
export function listTextOf(view: BotChannelView, key: string): string {
  const stored = view.values[key]
  return Array.isArray(stored) ? stored.join("\n") : ""
}

/** A text field's stored value. */
export function textOf(view: BotChannelView, key: string): string {
  const stored = view.values[key]
  return typeof stored === "string" ? stored : ""
}

/** Why a typed value cannot be saved, as the Host would refuse it. */
export type ChannelFieldIssue =
  | { readonly kind: "length"; readonly max: number }
  | { readonly kind: "format" }
  | { readonly kind: "count"; readonly max: number }
  | { readonly kind: "item"; readonly item: string }

const wholeMatch = (pattern: string) => new RegExp(`^(?:${pattern})$`, "u")

export function textIssue(field: BotChannelTextField, text: string): ChannelFieldIssue | null {
  const trimmed = text.trim()
  if (trimmed.length > field.maxLength) return { kind: "length", max: field.maxLength }
  if (trimmed !== "" && field.pattern !== undefined && !wholeMatch(field.pattern).test(trimmed)) {
    return { kind: "format" }
  }
  return null
}

export function listIssue(field: BotChannelListField, text: string): ChannelFieldIssue | null {
  const items = [...new Set(listItemsOf(text))]
  if (items.length > field.maxItems) return { kind: "count", max: field.maxItems }
  const invalid = items.find(
    (item) =>
      item.length > field.item.maxLength ||
      (field.item.pattern !== undefined && !wholeMatch(field.item.pattern).test(item)),
  )
  return invalid === undefined ? null : { kind: "item", item: invalid }
}

/** Whether the channel names nobody in its owners field (never, when it names no such field). */
export function ownersEmpty(view: BotChannelView): boolean {
  const key = view.channel.owners
  if (key === undefined) return false
  const stored = view.values[key]
  return !Array.isArray(stored) || stored.length === 0
}

/** The required fields without a value, while the channel is on. */
export function missingFields(view: BotChannelView): ReadonlySet<string> {
  return new Set(view.status.state === "incomplete" ? view.status.missing : [])
}

/** What the channel's title row says: its state, worst first, and the line under its name. */
export interface ChannelHeadline {
  readonly tone: PillTone
  readonly state:
    | "off"
    | "failed"
    | "incomplete"
    | "noOwners"
    | "waiting"
    | "connecting"
    | "connected"
  /** The connected account, or the failure. */
  readonly meta?: string
}

export function channelHeadline(view: BotChannelView): ChannelHeadline {
  const { status } = view
  switch (status.state) {
    case "off":
      return { tone: "idle", state: "off" }
    case "failed":
      return { tone: "danger", state: "failed", meta: status.message }
    case "incomplete":
      return { tone: "warning", state: "incomplete" }
    default:
      break
  }
  const account = status.state === "connected" ? status.account : undefined
  const meta = account === undefined ? {} : { meta: account }
  if (ownersEmpty(view)) return { tone: "warning", state: "noOwners", ...meta }
  switch (status.state) {
    case "waiting":
      return { tone: "busy", state: "waiting" }
    case "connecting":
      return { tone: "busy", state: "connecting" }
    case "connected":
      return { tone: "success", state: "connected", ...meta }
  }
}
