import type { BotSettingsArea } from "../../../settings-contract"
import type { BotChannelText } from "../../../shared/channels"
import { CONNECTOR_EVENT_DELIVERIES } from "../../../shared/connections"
import {
  type BotConnectorChange,
  type BotConnectorView,
  CONNECTOR_PERMISSIONS,
  type ConnectorPermission,
  type ConnectorSettingField,
  type ConnectorToolPermission,
} from "../../../shared/connectors"
import {
  type BotSettingEntry,
  type BotSettingValueShape,
  settingValue,
} from "../../../shared/settings"
import type { ConnectorPanel } from "../../connectors/panel"
import type { SettingsAreaSource } from "../catalog"
import { APPLIED, BOT_SETTINGS_PLACE, placeIn, refused } from "./common"

export interface ConnectorAreasDeps {
  connectors(): readonly { readonly id: string; readonly name: string }[]
  panel: Pick<ConnectorPanel, "views" | "configure" | "setPermission">
}

const CONNECTORS: BotChannelText = { en: "Connectors", ja: "コネクター" }

const ENABLED = "enabled"
const EVENTS = "events"
const TOOL = "tool."
const DEFAULT = "default"

const STRICTNESS: Readonly<Record<ConnectorPermission, number>> = {
  allow: 0,
  ask: 1,
  disallow: 2,
}

const PERMISSION_LABEL: Readonly<Record<ConnectorPermission, BotChannelText>> = {
  allow: { en: "Allow", ja: "許可" },
  ask: { en: "Ask", ja: "確認" },
  disallow: { en: "Disallow", ja: "禁止" },
}

const DELIVERY_LABEL = {
  off: { en: "Off", ja: "オフ" },
  notify: { en: "Tell the Main session", ja: "メインセッションに伝える" },
  queue: { en: "Keep for the bot to fetch", ja: "ボットが取りに来るまで保つ" },
} as const satisfies Readonly<Record<(typeof CONNECTOR_EVENT_DELIVERIES)[number], BotChannelText>>

function fieldShape(field: ConnectorSettingField): BotSettingValueShape {
  switch (field.kind) {
    case "toggle":
      return { kind: "toggle" }
    case "choice":
      return { kind: "choice", choices: field.options }
    case "integer":
      return { kind: "integer", min: field.min, max: field.max }
    case "text":
      return {
        kind: "text",
        maxLength: field.maxLength,
        ...(field.pattern === undefined ? {} : { pattern: field.pattern }),
      }
  }
}

function permissionEntry(
  view: BotConnectorView,
  permission: ConnectorToolPermission,
): BotSettingEntry {
  const tool = view.connector.tools.find((known) => known.name === permission.tool)
  const accepts: BotSettingValueShape = {
    kind: "choice",
    choices: [
      {
        value: DEFAULT,
        label: {
          en: `Default (${PERMISSION_LABEL[permission.default].en})`,
          ja: `既定（${PERMISSION_LABEL[permission.default].ja}）`,
        },
      },
      ...CONNECTOR_PERMISSIONS.map((value) => ({ value, label: PERMISSION_LABEL[value] })),
    ],
  }
  return {
    key: `${TOOL}${permission.tool}`,
    label: { en: tool?.toolName ?? permission.tool },
    agentNote: `Whether ${tool?.toolName ?? permission.tool} runs at once (allow), waits for your owner's approval (ask) or is not offered to you (disallow); default is the connector's own (${permission.default}).`,
    value: settingValue(accepts, permission.override ?? DEFAULT),
    accepts,
    change: {
      kind: "directional",
      strictness: { ...STRICTNESS, [DEFAULT]: STRICTNESS[permission.default] },
      tighten: "free",
      loosen: "approve",
    },
  }
}

function entriesOf(view: BotConnectorView): readonly BotSettingEntry[] {
  const { connector } = view
  const events = view.events
  return [
    {
      key: ENABLED,
      label: { en: "On", ja: "オン" },
      agentNote: `Whether you can use ${connector.name} (its tools${connector.events === undefined ? "" : " and events"}).`,
      value: settingValue({ kind: "toggle" }, view.enabled),
      accepts: { kind: "toggle" },
      change: "approve",
    },
    ...connector.settings.map((field): BotSettingEntry => {
      const accepts = fieldShape(field)
      return {
        key: field.key,
        label: field.label,
        ...(field.description === undefined ? {} : { description: field.description }),
        agentNote: field.agent.note,
        value: settingValue(accepts, view.values[field.key] ?? field.default),
        accepts,
        change: field.agent.change,
      }
    }),
    ...(events === undefined
      ? []
      : [
          ((): BotSettingEntry => {
            const accepts: BotSettingValueShape = {
              kind: "choice",
              choices: CONNECTOR_EVENT_DELIVERIES.map((value) => ({
                value,
                label: DELIVERY_LABEL[value],
              })),
            }
            return {
              key: EVENTS,
              label: { en: "Events", ja: "イベント" },
              agentNote: `How events of ${connector.name} reach you: off, notify (each one reaches your Main session as a notice) or queue (they wait until you fetch them).`,
              value: settingValue(accepts, events.delivery),
              accepts,
              change: "approve",
            }
          })(),
        ]),
    ...view.permissions.map((permission) => permissionEntry(view, permission)),
  ]
}

function connectorArea(
  connector: { readonly id: string; readonly name: string },
  deps: ConnectorAreasDeps,
): BotSettingsArea {
  const name: BotChannelText = { en: connector.name }
  const viewOf = (botId: string) => {
    const view = deps.panel.views(botId).find((item) => item.connector.id === connector.id)
    if (view === undefined) throw new Error(`connector "${connector.id}" is not registered`)
    return view
  }
  return {
    id: `connectors.${connector.id}`,
    label: name,
    location: placeIn(BOT_SETTINGS_PLACE, CONNECTORS, name),
    entries: async (botId) => entriesOf(viewOf(botId)),
    implied: () => [],
    async apply(botId, changes) {
      try {
        const view = viewOf(botId)
        const values: Record<string, string | number | boolean> = { ...view.values }
        let enabled = view.enabled
        let events = view.events?.delivery
        let configured = false
        const permissions: {
          readonly tool: string
          readonly permission: ConnectorPermission | null
        }[] = []
        for (const { key, value } of changes) {
          const field = view.connector.settings.find((known) => known.key === key)
          if (key === ENABLED && typeof value === "boolean") {
            enabled = value
            configured = true
          } else if (key === EVENTS && events !== undefined && typeof value === "string") {
            events = value as typeof events
            configured = true
          } else if (key.startsWith(TOOL) && typeof value === "string") {
            permissions.push({
              tool: key.slice(TOOL.length),
              permission: value === DEFAULT ? null : (value as ConnectorPermission),
            })
          } else if (
            field !== undefined &&
            (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
          ) {
            values[key] = value
            configured = true
          } else {
            throw new Error(`"${key}" cannot take ${JSON.stringify(value)}`)
          }
        }
        if (configured) {
          const change: BotConnectorChange = {
            enabled,
            values,
            ...(events === undefined ? {} : { events }),
          }
          await deps.panel.configure(botId, connector.id, change)
        }
        for (const { tool, permission } of permissions) {
          await deps.panel.setPermission(botId, { connectorId: connector.id, tool, permission })
        }
        return APPLIED
      } catch (error) {
        return refused(error)
      }
    },
  }
}

export function connectorAreas(deps: ConnectorAreasDeps): SettingsAreaSource {
  return () => deps.connectors().map((connector) => connectorArea(connector, deps))
}
