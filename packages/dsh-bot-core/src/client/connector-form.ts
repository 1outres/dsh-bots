import type { ConnectorEventDelivery } from "../shared/connections"
import {
  type BotConnectorChange,
  type BotConnectorView,
  type ConnectorReadiness,
  type ConnectorSettingCheck,
  type ConnectorSettingField,
  type ConnectorSwitchBlock,
  type ConnectorSwitchSubject,
  checkConnectorSetting,
  connectorSwitchBlock,
} from "../shared/connectors"
import type { BotEnvironmentSpec } from "../shared/environment"
import type { PillTone } from "./ui/StatusPill"

/** One change made in a connector's settings, saved at once. */
export type ConnectorEdit =
  | { readonly kind: "enabled"; readonly enabled: boolean }
  | { readonly kind: "value"; readonly key: string; readonly value: string | number | boolean }
  | { readonly kind: "events"; readonly delivery: ConnectorEventDelivery }

/** The whole change a connector's `configure` takes: what is stored, with `edit` applied. */
export function connectorChange(view: BotConnectorView, edit: ConnectorEdit): BotConnectorChange {
  const values = edit.kind === "value" ? { ...view.values, [edit.key]: edit.value } : view.values
  const events = edit.kind === "events" ? edit.delivery : view.events?.delivery
  return {
    enabled: edit.kind === "enabled" ? edit.enabled : view.enabled,
    values,
    ...(view.connector.events === undefined || events === undefined ? {} : { events }),
  }
}

const INTEGER = /^\s*-?\d+\s*$/

/** A typed field value checked as the Host checks it: integers from their digits, text trimmed. */
export function checkTyped(field: ConnectorSettingField, text: string): ConnectorSettingCheck {
  if (field.kind === "integer") {
    return checkConnectorSetting(field, INTEGER.test(text) ? Number(text) : Number.NaN)
  }
  return checkConnectorSetting(field, text)
}

/** A stored value as its field shows it in a text field. */
export const typedOf = (value: string | number | boolean | undefined): string =>
  value === undefined ? "" : String(value)

/** The bot's connectors split into those turned on and off, each in registration order. */
export function connectorsByState(views: readonly BotConnectorView[]): {
  readonly on: readonly BotConnectorView[]
  readonly off: readonly BotConnectorView[]
} {
  return {
    on: views.filter((view) => view.enabled),
    off: views.filter((view) => !view.enabled),
  }
}

const switchSubjectOf = (view: BotConnectorView): ConnectorSwitchSubject => ({
  id: view.connector.id,
  name: view.connector.name,
  requires: view.connector.requires,
  minimumSpec: view.connector.minimumSpec,
  enabled: view.enabled,
})

/** Why the Host would refuse to flip the connector's switch now, among the bot's connectors `views` and with its `spec`. */
export function switchBlockOf(
  view: BotConnectorView,
  views: readonly BotConnectorView[],
  spec: BotEnvironmentSpec | undefined,
): ConnectorSwitchBlock | undefined {
  return connectorSwitchBlock(
    switchSubjectOf(view),
    views.map(switchSubjectOf),
    !view.enabled,
    spec,
  )
}

/** The pill tone of a connector's readiness. */
export const READINESS_TONE: Readonly<Record<ConnectorReadiness["state"], PillTone>> = {
  disabled: "idle",
  unavailable: "warning",
  preparing: "busy",
  ready: "success",
  failed: "danger",
}

/** The accounts the connector may act as, each with whether it can now. */
export function connectorAccounts(view: BotConnectorView) {
  return (view.accounts ?? []).map((account) => ({
    name: account.email ?? account.label,
    usable: account.granted && account.status === "active",
    granted: account.granted,
  }))
}
