import {
  type BotChannelChange,
  type BotChannelPublicValues,
  type BotChannelSecretChange,
  type BotChannelSharedChange,
  type BotChannelSharedListField,
  type BotChannelSharedTextField,
  type BotChannelSharedView,
  type BotChannelView,
  channelValuesAfter,
} from "../shared/channels"
import type { PillTone } from "./ui/StatusPill"

export type ChannelFieldEdit =
  | { readonly kind: "value"; readonly key: string; readonly value: string | readonly string[] }
  | { readonly kind: "secret"; readonly key: string; readonly secret: string | null }

export type ChannelEdit =
  | { readonly kind: "enabled"; readonly enabled: boolean }
  | ChannelFieldEdit
  | { readonly kind: "profile"; readonly sync: boolean }

export interface ChannelFieldsState {
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, boolean>>
  readonly enabled: boolean
  readonly owners?: string
}

export function fieldsStateOf(view: BotChannelView): ChannelFieldsState {
  return {
    values: view.values,
    secrets: view.secrets,
    enabled: view.enabled,
    ...(view.channel.owners === undefined ? {} : { owners: view.channel.owners }),
  }
}

export function secretChangeOf(
  edit: ChannelFieldEdit,
): Readonly<Record<string, BotChannelSecretChange>> {
  if (edit.kind !== "secret") return {}
  return {
    [edit.key]: edit.secret === null ? { op: "clear" } : { op: "set", value: edit.secret.trim() },
  }
}

export function sharedChangeWith(
  view: BotChannelSharedView,
  edit: ChannelFieldEdit | { readonly kind: "newBots"; readonly on: boolean },
): BotChannelSharedChange {
  return {
    values: channelValuesAfter(
      view.channel.fields,
      view.values,
      edit.kind === "value" ? { [edit.key]: edit.value } : {},
    ),
    secrets: edit.kind === "newBots" ? {} : secretChangeOf(edit),
    newBots: edit.kind === "newBots" ? edit.on : view.newBots,
  }
}

export function changeWith(view: BotChannelView, edit: ChannelEdit): BotChannelChange {
  const values = channelValuesAfter(
    view.channel.fields,
    view.values,
    edit.kind === "value" ? { [edit.key]: edit.value } : {},
  )
  return {
    enabled: edit.kind === "enabled" ? edit.enabled : view.enabled,
    values,
    secrets: edit.kind === "secret" ? secretChangeOf(edit) : {},
    profileSync: edit.kind === "profile" ? edit.sync : view.profile?.sync === true,
  }
}

export function listItemsOf(text: string): readonly string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function listTextOf(view: Pick<ChannelFieldsState, "values">, key: string): string {
  const stored = view.values[key]
  return Array.isArray(stored) ? stored.join("\n") : ""
}

export function textOf(view: Pick<ChannelFieldsState, "values">, key: string): string {
  const stored = view.values[key]
  return typeof stored === "string" ? stored : ""
}

export type ChannelFieldIssue =
  | { readonly kind: "length"; readonly max: number }
  | { readonly kind: "format" }
  | { readonly kind: "count"; readonly max: number }
  | { readonly kind: "item"; readonly item: string }

const wholeMatch = (pattern: string) => new RegExp(`^(?:${pattern})$`, "u")

export function textIssue(
  field: BotChannelSharedTextField,
  text: string,
): ChannelFieldIssue | null {
  const trimmed = text.trim()
  if (trimmed.length > field.maxLength) return { kind: "length", max: field.maxLength }
  if (trimmed !== "" && field.pattern !== undefined && !wholeMatch(field.pattern).test(trimmed)) {
    return { kind: "format" }
  }
  return null
}

export function listIssue(
  field: BotChannelSharedListField,
  text: string,
): ChannelFieldIssue | null {
  const items = [...new Set(listItemsOf(text))]
  if (items.length > field.maxItems) return { kind: "count", max: field.maxItems }
  const invalid = items.find(
    (item) =>
      item.length > field.item.maxLength ||
      (field.item.pattern !== undefined && !wholeMatch(field.item.pattern).test(item)),
  )
  return invalid === undefined ? null : { kind: "item", item: invalid }
}

export function ownersEmpty(view: BotChannelView): boolean {
  return ownersEmptyIn(fieldsStateOf(view))
}

export function ownersEmptyIn(view: ChannelFieldsState): boolean {
  const key = view.owners
  if (key === undefined) return false
  const stored = view.values[key]
  return !Array.isArray(stored) || stored.length === 0
}

export function missingFields(view: Pick<BotChannelView, "status">): ReadonlySet<string> {
  return new Set(view.status.state === "incomplete" ? view.status.missing : [])
}

export interface ChannelHeadline {
  readonly tone: PillTone
  readonly state:
    | "off"
    | "unconfigured"
    | "failed"
    | "incomplete"
    | "noOwners"
    | "waiting"
    | "connecting"
    | "connected"
  readonly meta?: string
}

export function channelHeadline(view: BotChannelView): ChannelHeadline {
  const { status } = view
  switch (status.state) {
    case "off":
      return { tone: "idle", state: "off" }
    case "unconfigured":
      return { tone: "warning", state: "unconfigured" }
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
