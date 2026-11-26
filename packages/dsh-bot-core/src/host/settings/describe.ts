import type { BotSettingsArea } from "../../settings-contract"
import type { BotChannelText } from "../../shared/channels"
import {
  type BotSettingChangePolicy,
  type BotSettingChangeRule,
  type BotSettingEntry,
  type BotSettingItemShape,
  type BotSettingValue,
  type BotSettingValueShape,
  pickSettingText,
} from "../../shared/settings"

type Area = Pick<BotSettingsArea, "id" | "label" | "location">

export interface AreaReading {
  readonly area: Area
  readonly entries: readonly BotSettingEntry[] | { readonly failed: string }
}

const RULE_TEXT: Readonly<Record<BotSettingChangeRule, string>> = {
  free: "free (when your owner asks)",
  approve: "needs your owner's approval (asked when you change it)",
  never: "you cannot change it; your owner can, in the Web UI",
}

const RULE_MARK: Readonly<Record<BotSettingChangeRule, string>> = {
  free: "free",
  approve: "approve",
  never: "never",
}

export function placeOf(area: Area, entry: BotSettingEntry, language: string | undefined) {
  return `${pickSettingText(area.location, language)} > ${pickSettingText(entry.label, language)}`
}

function nowOf(value: BotSettingValue, language: string | undefined): string {
  const shown = pickSettingText(value.shown, language)
  const raw = value.raw
  if (raw === null || typeof raw === "boolean") return shown
  const written = JSON.stringify(raw)
  return shown === (typeof raw === "string" ? raw : String(raw)) || shown === written
    ? written
    : `${shown} (${written})`
}

function choicesOf(
  choices: readonly { readonly value: string; readonly label: BotChannelText }[],
  language: string | undefined,
): string {
  return choices
    .map((choice) => `${JSON.stringify(choice.value)} (${pickSettingText(choice.label, language)})`)
    .join(", ")
}

function itemText(shape: BotSettingItemShape, language: string | undefined): string {
  if (shape.kind === "choice") return `one of ${choicesOf(shape.choices, language)}`
  const known =
    shape.known === undefined || shape.known.length === 0
      ? ""
      : ` (known now: ${choicesOf(shape.known, language)})`
  return `text of up to ${shape.maxLength} characters${shape.pattern === undefined ? "" : ` matching /${shape.pattern}/`}${known}`
}

function acceptsOf(shape: BotSettingValueShape, language: string | undefined): string {
  switch (shape.kind) {
    case "toggle":
      return "Accepts: true or false."
    case "integer":
      return `Accepts: an integer from ${shape.min} to ${shape.max}.`
    case "text":
      return `Accepts: ${itemText(shape, language)}.`
    case "choice":
      return `Choices: ${choicesOf(shape.choices, language)}.`
    case "list":
      return `Accepts: a list of ${shape.minItems} to ${shape.maxItems} items, each ${itemText(shape.item, language)}.`
  }
}

function changeText(policy: BotSettingChangePolicy): string {
  if (typeof policy === "string") return RULE_TEXT[policy]
  const order = Object.entries(policy.strictness)
    .sort(([, left], [, right]) => left - right)
    .map(([value]) => value)
    .join(" → ")
  return `when it gets stricter (${order}): ${RULE_TEXT[policy.tighten]}; when it gets looser: ${RULE_TEXT[policy.loosen]}`
}

function markOf(policy: BotSettingChangePolicy): string {
  return typeof policy === "string"
    ? RULE_MARK[policy]
    : `${RULE_MARK[policy.tighten]} when stricter, ${RULE_MARK[policy.loosen]} when looser`
}

function headOf(area: Area, language: string | undefined): string {
  return `${area.id} — "${pickSettingText(area.label, language)}" (Web UI: ${pickSettingText(area.location, language)})`
}

export function describeArea(
  area: Area,
  entries: readonly BotSettingEntry[],
  language: string | undefined,
): string {
  if (entries.length === 0) return `${headOf(area, language)}\n  (no settings)`
  return entries
    .map((entry) =>
      [
        `${area.id} / ${entry.key} — "${pickSettingText(entry.label, language)}" (Web UI: ${placeOf(area, entry, language)})`,
        ...(entry.description === undefined
          ? []
          : [`  In the Web UI: ${pickSettingText(entry.description, language)}`]),
        `  For you: ${entry.agentNote}`,
        `  Now: ${nowOf(entry.value, language)}.${entry.accepts === undefined ? "" : ` ${acceptsOf(entry.accepts, language)}`}`,
        `  Change: ${changeText(entry.change)}.`,
      ].join("\n"),
    )
    .join("\n\n")
}

export function describeAreas(readings: readonly AreaReading[], language: string | undefined) {
  const lines = [
    "Your settings, by area. Call bot_settings action=describe area=<id> for what each setting means, what it accepts and whether you may change it.",
  ]
  for (const { area, entries } of readings) {
    lines.push("", headOf(area, language))
    if ("failed" in entries) {
      lines.push(`  (could not be read: ${entries.failed})`)
      continue
    }
    if (entries.length === 0) lines.push("  (no settings)")
    for (const entry of entries) {
      lines.push(
        `  - ${entry.key} "${pickSettingText(entry.label, language)}": ${nowOf(entry.value, language)} [${markOf(entry.change)}]`,
      )
    }
  }
  return lines.join("\n")
}
