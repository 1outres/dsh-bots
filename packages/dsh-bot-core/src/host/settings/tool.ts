import type { BotSessionKind } from "../../internal"
import type { BotSettingsArea } from "../../settings-contract"
import type { BotChannelText } from "../../shared/channels"
import {
  type BotSettingChange,
  type BotSettingChangeItem,
  type BotSettingChangeRecord,
  type BotSettingChangeRule,
  type BotSettingEntry,
  type BotSettingJson,
  changeRuleOf,
  MAX_SETTING_REASON_LENGTH,
  pickSettingText,
  sameSettingJson,
  settingValue,
  settingValueProblem,
} from "../../shared/settings"
import type { InteractionPlace } from "../interactions/board"
import type { SettingsApprovals } from "./approval"
import type { SettingsTurns } from "./authority"
import type { SettingsCatalog } from "./catalog"
import { type AreaReading, describeArea, describeAreas, placeOf } from "./describe"
import type { SettingChangeStore } from "./store"
import { NO_TURN, NOT_THE_OWNER, SETTINGS_ACTIONS, SETTINGS_TOOL } from "./texts"

export class SettingsToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SettingsToolError"
  }
}

export type SettingsToolArgs =
  | { readonly action: "describe"; readonly area?: string }
  | {
      readonly action: "change"
      readonly area: string
      readonly changes: readonly BotSettingChange[]
      readonly reason: string
    }

const isJson = (value: unknown): value is BotSettingJson =>
  value === null ||
  typeof value === "boolean" ||
  typeof value === "number" ||
  typeof value === "string" ||
  (Array.isArray(value) && value.every((item) => typeof item === "string"))

export function parseSettingsArgs(input: unknown): SettingsToolArgs {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SettingsToolError("the arguments must be an object")
  }
  const args = input as Record<string, unknown>
  const area = args.area
  if (area !== undefined && (typeof area !== "string" || area.trim() === "")) {
    throw new SettingsToolError("area must be an area id from bot_settings action=describe")
  }
  if (args.action === "describe") {
    return area === undefined ? { action: "describe" } : { action: "describe", area }
  }
  if (args.action !== "change") {
    throw new SettingsToolError(`action must be one of ${SETTINGS_ACTIONS.join(", ")}`)
  }
  if (area === undefined) throw new SettingsToolError("change needs the area of its settings")
  const reason = typeof args.reason === "string" ? args.reason.trim() : ""
  if (reason === "") throw new SettingsToolError("change needs a reason your owner can read")
  if (reason.length > MAX_SETTING_REASON_LENGTH) {
    throw new SettingsToolError(`reason is longer than ${MAX_SETTING_REASON_LENGTH} characters`)
  }
  if (!Array.isArray(args.changes) || args.changes.length === 0) {
    throw new SettingsToolError('changes must list at least one { "key", "value" }')
  }
  const changes = args.changes.map((change, index): BotSettingChange => {
    if (typeof change !== "object" || change === null) {
      throw new SettingsToolError(`changes[${index}] must be { "key", "value" }`)
    }
    const { key, value } = change as Record<string, unknown>
    if (typeof key !== "string" || key === "") {
      throw new SettingsToolError(`changes[${index}].key must be a setting key`)
    }
    if (!isJson(value)) {
      throw new SettingsToolError(
        `changes[${index}].value must be text, a number, true or false, or a list of text`,
      )
    }
    return { key, value }
  })
  const keys = new Set(changes.map((change) => change.key))
  if (keys.size !== changes.length) throw new SettingsToolError("changes names a key twice")
  return { action: "change", area, changes, reason }
}

export interface SettingsToolRequest {
  readonly agentId: string
  readonly args: unknown
}

export interface SettingsToolDeps {
  sealed(botId: string, token: string): boolean
  session(
    botId: string,
    agentId: string,
  ): { readonly sessionId: string; readonly kind: BotSessionKind } | undefined
  language(botId: string): string | undefined
  catalog: Pick<SettingsCatalog, "list" | "get">
  turns: Pick<SettingsTurns, "of">
  approvals: SettingsApprovals
  store: Pick<SettingChangeStore, "record">
  readonly historyPlace: BotChannelText
  deadline(): AbortSignal
  newId(): string
  now(): number
}

export interface SettingsTool {
  available(botId: string, token: string, agentId: string): boolean
  call(
    botId: string,
    token: string,
    request: SettingsToolRequest,
    signal: AbortSignal,
  ): Promise<{ readonly text: string }>
}

const CONVERSING: readonly BotSessionKind[] = ["main", "web"]

interface PlannedChange {
  readonly entry: BotSettingEntry
  readonly value: BotSettingJson
  readonly rule: BotSettingChangeRule
}

export function changedItems(
  before: readonly BotSettingEntry[],
  after: readonly BotSettingEntry[],
): readonly BotSettingChangeItem[] {
  return after.flatMap((entry) => {
    const earlier = before.find((known) => known.key === entry.key)
    return earlier === undefined || sameSettingJson(earlier.value.raw, entry.value.raw)
      ? []
      : [{ key: entry.key, label: entry.label, before: earlier.value, after: entry.value }]
  })
}

const bilingual = (en: string, ja: string): BotChannelText => ({ en, ja })

export function createSettingsTool(deps: SettingsToolDeps): SettingsTool {
  const queues = new Map<string, Promise<unknown>>()
  const serial = <T>(botId: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(botId) ?? Promise.resolve()).catch(() => undefined).then(work)
    const settled = next.catch(() => undefined)
    queues.set(botId, settled)
    void settled.then(() => {
      if (queues.get(botId) === settled) queues.delete(botId)
    })
    return next
  }

  const sessionOf = (botId: string, token: string, agentId: string) => {
    if (!deps.sealed(botId, token)) {
      throw new Error(
        `bot-core: this preset revision of bot "${botId}" was not registered by this bot-core`,
      )
    }
    const session = deps.session(botId, agentId)
    if (session === undefined) {
      throw new Error(`bot-core: Agent "${agentId}" does not run a session of bot "${botId}"`)
    }
    return session
  }

  const signalOf = (caller: AbortSignal) => AbortSignal.any([caller, deps.deadline()])

  const requireArea = (id: string): BotSettingsArea => {
    const area = deps.catalog.get(id)
    if (area === undefined) {
      throw new SettingsToolError(
        `there is no settings area "${id}"; areas: ${deps.catalog
          .list()
          .map((known) => known.id)
          .join(", ")}`,
      )
    }
    return area
  }

  const describe = async (botId: string, areaId: string | undefined, signal: AbortSignal) => {
    const language = deps.language(botId)
    if (areaId !== undefined) {
      const area = requireArea(areaId)
      return describeArea(area, await area.entries(botId, signalOf(signal)), language)
    }
    const readings = await Promise.all(
      deps.catalog.list().map(async (area): Promise<AreaReading> => {
        try {
          return { area, entries: await area.entries(botId, signalOf(signal)) }
        } catch (error) {
          signal.throwIfAborted()
          return {
            area,
            entries: { failed: error instanceof Error ? error.message : String(error) },
          }
        }
      }),
    )
    return describeAreas(readings, language)
  }

  const plan = (
    area: BotSettingsArea,
    entries: readonly BotSettingEntry[],
    changes: readonly BotSettingChange[],
    language: string | undefined,
  ): readonly PlannedChange[] =>
    changes.flatMap((change) => {
      const entry = entries.find((known) => known.key === change.key)
      if (entry === undefined) {
        throw new SettingsToolError(
          `area "${area.id}" has no setting "${change.key}"; its settings: ${entries.map((known) => known.key).join(", ")}`,
        )
      }
      if (sameSettingJson(entry.value.raw, change.value)) return []
      const rule = changeRuleOf(entry.change, entry.value.raw, change.value)
      if (rule === "never" || entry.accepts === undefined) {
        throw new SettingsToolError(
          `you cannot change ${area.id} / ${entry.key}; nothing changed. Your owner can change it in the Web UI: ${placeOf(area, entry, language)}`,
        )
      }
      const problem = settingValueProblem(entry.accepts, change.value)
      if (problem !== undefined) {
        throw new SettingsToolError(
          `the value for ${area.id} / ${entry.key} ${problem}; nothing changed`,
        )
      }
      return [{ entry, value: change.value, rule }]
    })

  const itemsOf = (planned: readonly PlannedChange[]): readonly BotSettingChangeItem[] =>
    planned.map(({ entry, value }) => ({
      key: entry.key,
      label: entry.label,
      before: entry.value,
      after: settingValue(entry.accepts, value),
    }))

  const impliedItems = (
    entries: readonly BotSettingEntry[],
    implied: readonly BotSettingChange[],
  ): readonly BotSettingChangeItem[] =>
    implied.flatMap(({ key, value }) => {
      const entry = entries.find((known) => known.key === key)
      return entry === undefined || sameSettingJson(entry.value.raw, value)
        ? []
        : [
            {
              key,
              label: entry.label,
              before: entry.value,
              after: settingValue(entry.accepts, value),
            },
          ]
    })

  const lineOf = (item: BotSettingChangeItem, language: "en" | "ja") =>
    `- **${pickSettingText(item.label, language)}**: ${pickSettingText(item.before.shown, language)} → ${pickSettingText(item.after.shown, language)}`

  const approvalOf = (
    area: BotSettingsArea,
    items: readonly BotSettingChangeItem[],
    reason: string,
  ) => ({
    question: bilingual(
      `Change your bot's settings: ${area.label.en}?`,
      `ボットの設定「${pickSettingText(area.label, "ja")}」を変更しますか？`,
    ),
    detail: bilingual(
      [...items.map((item) => lineOf(item, "en")), "", `Reason: ${reason}`].join("\n"),
      [...items.map((item) => lineOf(item, "ja")), "", `理由: ${reason}`].join("\n"),
    ),
  })

  const summaryOf = (items: readonly BotSettingChangeItem[], language: string | undefined) =>
    items
      .map(
        (item) =>
          `${pickSettingText(item.label, language)}: ${pickSettingText(item.before.shown, language)} → ${pickSettingText(item.after.shown, language)}`,
      )
      .join("; ")

  const change = async (
    botId: string,
    session: { readonly sessionId: string; readonly kind: BotSessionKind },
    args: Extract<SettingsToolArgs, { action: "change" }>,
    signal: AbortSignal,
  ) => {
    const turn = deps.turns.of(session.sessionId)
    if (turn === undefined) throw new SettingsToolError(NO_TURN)
    if (turn.startedBy !== "owner") throw new SettingsToolError(NOT_THE_OWNER)
    const language = deps.language(botId)
    const area = requireArea(args.area)
    const entries = await area.entries(botId, signalOf(signal))
    const planned = plan(area, entries, args.changes, language)
    if (planned.length === 0) {
      return `Nothing to change: ${args.changes.map((item) => item.key).join(", ")} already ${args.changes.length === 1 ? "has" : "have"} that value.`
    }
    const implied = area.implied(
      botId,
      planned.map(({ entry, value }) => ({ key: entry.key, value })),
    )
    const items = [...itemsOf(planned), ...impliedItems(entries, implied)]
    const asks = planned.some(({ rule }) => rule === "approve" || turn.mixed)
    let approvedBy: BotSettingChangeRecord["approvedBy"]
    if (asks) {
      const place: InteractionPlace = {
        botId,
        sessionId: session.sessionId,
        main: session.kind === "main",
      }
      const outcome = await deps.approvals.ask({
        place,
        ...approvalOf(area, items, args.reason),
        signal,
      })
      if (outcome.kind === "rejected") {
        throw new SettingsToolError(
          "your owner declined this change, so nothing changed. Do not make it another way; tell your owner if something is left to do",
        )
      }
      if (outcome.kind === "withdrawn") {
        throw new SettingsToolError("the approval was withdrawn before an answer; nothing changed")
      }
      approvedBy = outcome.by
    }
    return serial(botId, async () => {
      const current = await area.entries(botId, signalOf(signal))
      const moved = planned.find(({ entry }) => {
        const now = current.find((known) => known.key === entry.key)
        return now === undefined || !sameSettingJson(now.value.raw, entry.value.raw)
      })
      if (moved !== undefined) {
        throw new SettingsToolError(
          `${area.id} / ${moved.entry.key} changed meanwhile, so nothing changed; describe it again before you change it`,
        )
      }
      const result = await area.apply(
        botId,
        planned.map(({ entry, value }) => ({ key: entry.key, value })),
      )
      if (!result.applied) {
        throw new SettingsToolError(
          `${area.id} was not changed: ${pickSettingText(result.reason, language)}`,
        )
      }
      const applied = changedItems(current, await area.entries(botId, signalOf(signal)))
      await deps.store.record({
        id: deps.newId(),
        botId,
        at: deps.now(),
        area: area.id,
        areaLabel: area.label,
        location: area.location,
        items: applied,
        reason: args.reason,
        ...(approvedBy === undefined ? {} : { approvedBy }),
        sessionId: session.sessionId,
      })
      return `Changed ${area.id}: ${summaryOf(applied, language)}.${approvedBy === undefined ? "" : " Your owner approved it."} Your owner can see and undo it in the Web UI: ${pickSettingText(deps.historyPlace, language)}.`
    })
  }

  return {
    available(botId, token, agentId) {
      try {
        return CONVERSING.includes(sessionOf(botId, token, agentId).kind)
      } catch {
        return false
      }
    },
    async call(botId, token, request, signal) {
      const session = sessionOf(botId, token, request.agentId)
      if (!CONVERSING.includes(session.kind)) {
        throw new SettingsToolError(
          `${SETTINGS_TOOL} works only in your conversations with your owner (your Main session and sessions your owner opens)`,
        )
      }
      const args = parseSettingsArgs(request.args)
      const text =
        args.action === "describe"
          ? await describe(botId, args.area, signal)
          : await change(botId, session, args, signal)
      return { text }
    },
  }
}
