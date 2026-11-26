import { useState } from "react"
import { CONNECTOR_EVENT_DELIVERIES, type ConnectorEventDelivery } from "../../shared/connections"
import type {
  BotConnectorView,
  ConnectorReadiness,
  ConnectorSettingField,
  ConnectorSettingIssue,
  ConnectorSwitchBlock,
  ConnectorText,
  ConnectorUnavailableCause,
} from "../../shared/connectors"
import { checkTyped, READINESS_TONE, typedOf } from "../connector-form"
import { ConnectorPreparing } from "../connector-preparing"
import type { ConnectorsFeed } from "../connectors-hub"
import type { MessageKey } from "../i18n"
import { localeFormat } from "../locale-format"
import type { SendersFeed } from "../senders/model"
import type { Translate } from "../types"
import { Button, Group, PageTitle, Row, Select, StatusPill, Switch, Tag, TextFieldRow } from "../ui"
import { READINESS_LABEL } from "./ConnectorsSection"
import { ConnectorTools } from "./ConnectorTools"
import { type ConnectorSaves, useConnectorSaves } from "./connector-saves"
import { switchBlockText } from "./connector-switch"
import { failureText } from "./failure-text"
import { SenderAccounts } from "./SenderAccounts"
import type { SettingsSectionProps } from "./sections"

const UNAVAILABLE_LABEL: Readonly<Record<ConnectorUnavailableCause, MessageKey>> = {
  accounts: "connectors.detail.unavailableAccounts",
  environment: "connectors.detail.unavailable",
  requirements: "connectors.detail.unavailableRequirements",
}

export interface ConnectorDetailProps {
  readonly t: Translate
  text(text: ConnectorText): string
  readonly view: BotConnectorView
  readonly block: ConnectorSwitchBlock | undefined
  readonly feed: ConnectorsFeed
  readonly confirm: SettingsSectionProps["confirm"]
  readonly senders: SendersFeed
  openSenders(connectionId: string): void
}

const DELIVERY_LABEL: Readonly<Record<ConnectorEventDelivery, MessageKey>> = {
  off: "connectors.events.off",
  notify: "connectors.events.notify",
  queue: "connectors.events.queue",
}

export function ConnectorDetail(props: ConnectorDetailProps) {
  const { t, text, view, block, feed, confirm } = props
  const { connector } = view
  const saves = useConnectorSaves({ t, view, feed })
  return (
    <div className="dshb-settings-groups" data-dshb-connector-detail={connector.id}>
      <PageTitle
        trailing={
          <>
            {view.enabled && (
              <StatusPill
                tone={READINESS_TONE[view.readiness.state]}
                label={t(READINESS_LABEL[view.readiness.state])}
                marks={{ "data-dshb-connector-state": view.readiness.state }}
              />
            )}
            <Switch
              checked={view.enabled}
              label={t("connectors.enabled", { connector: connector.name })}
              disabled={block !== undefined}
              onChange={(enabled) => saves.pick({ kind: "enabled", enabled })}
              marks={{ "data-dshb-connector-enabled": "" }}
            />
          </>
        }
      >
        <span title={connector.description === undefined ? undefined : text(connector.description)}>
          {connector.name}
        </span>
      </PageTitle>
      {saves.error !== null && (
        <p className="dshb-ui-error" role="alert">
          {saves.error}
        </p>
      )}
      {block !== undefined && (
        <Group marks={{ "data-dshb-connector-switch-block": block.kind }}>
          <Row label={switchBlockText(t, connector.name, block)} />
        </Group>
      )}
      <Readiness t={t} text={text} view={view} retry={() => feed.retry(connector.id)} />
      {(connector.settings.length > 0 || connector.events !== undefined) && (
        <Group
          title={t("connectors.group.settings")}
          marks={{ "data-dshb-connector-settings": "" }}
        >
          {connector.settings.map((field) => (
            <SettingRow
              key={field.key}
              t={t}
              text={text}
              field={field}
              value={view.values[field.key]}
              saves={saves}
            />
          ))}
          {connector.events !== undefined && view.events !== undefined && (
            <Row
              label={t("connectors.events.label")}
              meta={connector.events.kinds.map((kind) => text(kind.label)).join(", ")}
              trailing={
                <>
                  {view.events.waiting > 0 && (
                    <Tag marks={{ "data-dshb-connector-waiting": "" }}>
                      {localeFormat(t).count("connectors.events.waiting", view.events.waiting)}
                    </Tag>
                  )}
                  <Select
                    value={view.events.delivery}
                    choices={CONNECTOR_EVENT_DELIVERIES.map((delivery) => ({
                      value: delivery,
                      label: t(DELIVERY_LABEL[delivery]),
                    }))}
                    label={t("connectors.events.label")}
                    onChange={(delivery) => saves.pick({ kind: "events", delivery })}
                    marks={{ "data-dshb-connector-events": "" }}
                  />
                </>
              }
            />
          )}
        </Group>
      )}
      {connector.senders !== undefined && (
        <SenderAccounts t={t} view={view} senders={props.senders} open={props.openSenders} />
      )}
      <ConnectorTools t={t} view={view} feed={feed} confirm={confirm} />
    </div>
  )
}

function Readiness(props: {
  readonly t: Translate
  text(text: ConnectorText): string
  readonly view: BotConnectorView
  retry(): Promise<unknown>
}) {
  const { t, text, view } = props
  const { readiness } = view
  switch (readiness.state) {
    case "disabled":
    case "ready":
      return null
    case "unavailable":
      return (
        <Group marks={{ "data-dshb-connector-readiness": "unavailable" }}>
          <Row label={t(UNAVAILABLE_LABEL[readiness.cause])} meta={readiness.reason} />
        </Group>
      )
    case "preparing":
      return (
        <Group marks={{ "data-dshb-connector-readiness": "preparing" }}>
          <ConnectorPreparing
            t={t}
            text={text}
            readiness={readiness}
            {...(view.connector.preparation?.hint === undefined
              ? {}
              : { hint: view.connector.preparation.hint })}
          />
        </Group>
      )
    case "failed":
      return <Failed t={t} readiness={readiness} retry={props.retry} />
  }
}

function Failed(props: {
  readonly t: Translate
  readonly readiness: Extract<ConnectorReadiness, { readonly state: "failed" }>
  retry(): Promise<unknown>
}) {
  const { t, readiness } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await props.retry()
    } catch (cause) {
      setError(failureText(t, cause))
    } finally {
      setBusy(false)
    }
  }
  const retryAt =
    readiness.retryAt === undefined
      ? undefined
      : t("connectors.detail.retryAt", { time: localeFormat(t).instant(readiness.retryAt, "time") })
  return (
    <Group marks={{ "data-dshb-connector-readiness": "failed" }}>
      <Row
        label={t("connectors.detail.failed")}
        meta={error ?? readiness.reason}
        metaTone="danger"
        trailing={
          <>
            {retryAt !== undefined && <span className="dshb-ui-row-meta">{retryAt}</span>}
            <Button
              variant="row"
              disabled={busy}
              onClick={() => void run()}
              marks={{ "data-dshb-connector-retry": "" }}
            >
              {busy ? t("connectors.retrying") : t("connectors.retry")}
            </Button>
          </>
        }
      />
    </Group>
  )
}

const ISSUE_KEY: Readonly<Record<ConnectorSettingIssue["kind"], MessageKey>> = {
  type: "connectors.issue.type",
  choice: "connectors.issue.choice",
  range: "connectors.issue.range",
  length: "connectors.issue.length",
  format: "connectors.issue.format",
}

const issueText = (t: Translate, issue: ConnectorSettingIssue): string =>
  issue.kind === "range"
    ? t(ISSUE_KEY.range, { min: issue.min, max: issue.max })
    : issue.kind === "length"
      ? t(ISSUE_KEY.length, { max: issue.max })
      : t(ISSUE_KEY[issue.kind])

function SettingRow(props: {
  readonly t: Translate
  text(text: ConnectorText): string
  readonly field: ConnectorSettingField
  readonly value: string | number | boolean | undefined
  readonly saves: ConnectorSaves
}) {
  const { t, text, field, value, saves } = props
  const label = text(field.label)
  const description = field.description === undefined ? undefined : text(field.description)
  const marks = { "data-dshb-connector-field": field.key }
  switch (field.kind) {
    case "toggle":
      return (
        <Row
          label={label}
          description={description}
          trailing={
            <Switch
              checked={value === true}
              label={label}
              onChange={(checked) => saves.pick({ kind: "value", key: field.key, value: checked })}
              marks={marks}
            />
          }
        />
      )
    case "choice":
      return (
        <Row
          label={label}
          description={description}
          trailing={
            <Select
              value={typedOf(value)}
              choices={field.options.map((option) => ({
                value: option.value,
                label: text(option.label),
              }))}
              label={label}
              onChange={(picked) => saves.pick({ kind: "value", key: field.key, value: picked })}
              marks={marks}
            />
          }
        />
      )
    case "integer":
    case "text":
      return (
        <TextFieldRow
          label={label}
          value={typedOf(value)}
          meta={
            field.kind === "integer"
              ? t("connectors.range", { min: field.min, max: field.max })
              : undefined
          }
          maxLength={field.kind === "text" ? field.maxLength : undefined}
          validate={(typed) => {
            const checked = checkTyped(field, typed)
            return checked.ok ? null : issueText(t, checked.issue)
          }}
          commit={(typed) => {
            const checked = checkTyped(field, typed)
            if (!checked.ok) throw new Error("bot-core: committed an invalid value")
            return saves.save({ kind: "value", key: field.key, value: checked.value })
          }}
          marks={marks}
        />
      )
  }
}
