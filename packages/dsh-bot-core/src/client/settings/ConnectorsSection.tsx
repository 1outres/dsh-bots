import type { BotView } from "../../shared/bots"
import type { ConnectionProviderView } from "../../shared/connections"
import type {
  BotConnectorView,
  ConnectorReadiness,
  ConnectorSwitchBlock,
  ConnectorText,
} from "../../shared/connectors"
import type { ConnectionsFeed, ConnectionsState } from "../connections-model"
import {
  type ProviderStanding,
  providerIdsOf,
  providerStanding,
  providersOf,
} from "../connections-view"
import {
  connectorAccounts,
  connectorsByState,
  READINESS_TONE,
  switchBlockOf,
} from "../connector-form"
import type { ConnectorsFeed, ConnectorsHub } from "../connectors-hub"
import { useObservable } from "../hooks"
import type { MessageKey } from "../i18n"
import { IconConnectors } from "../icons"
import { localeFormat } from "../locale-format"
import type { SendersFeed } from "../senders/model"
import type { Translate } from "../types"
import { EmptyState, ErrorText, Group, NavRow, Row, StatusPill, Switch } from "../ui"
import { BotAccountsPage } from "./BotAccountsPage"
import { ConnectorDetail } from "./ConnectorDetail"
import { useConnectorSaves } from "./connector-saves"
import { switchBlockText } from "./connector-switch"
import {
  accountsDetail,
  connectorDetail,
  connectorsPageOf,
  sendersDetail,
} from "./connectors-pages"
import { SenderPolicyPage } from "./SenderPolicyPage"
import type { SettingsSectionProps } from "./sections"

export interface ConnectorsSectionDeps {
  readonly connectors: ConnectorsHub
  readonly connections: ConnectionsFeed
  readonly senders: SendersFeed
  openConnectionSettings(): void
  text(text: ConnectorText): string
}

export const READINESS_LABEL: Readonly<Record<ConnectorReadiness["state"], MessageKey>> = {
  disabled: "connectors.state.disabled",
  unavailable: "connectors.state.unavailable",
  preparing: "connectors.state.preparing",
  ready: "connectors.state.ready",
  failed: "connectors.state.failed",
}

export function ConnectorsSection(props: SettingsSectionProps & ConnectorsSectionDeps) {
  const { t, bot, page, connectors, connections } = props
  const feed = connectors.feed(bot.id)
  const state = useObservable(feed)
  const accounts = useObservable(connections)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("connectors.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("connectors.unavailable", { message: state.failure.message })}</ErrorText>
  }
  const views = state.snapshot.connectors
  const { spec } = state.snapshot
  const shown = connectorsPageOf(page.detail)
  if (shown.kind === "connector") {
    const view = views.find((item) => item.connector.id === shown.connectorId)
    if (view !== undefined) {
      return (
        <ConnectorDetail
          t={t}
          text={props.text}
          view={view}
          block={switchBlockOf(view, views, spec)}
          feed={feed}
          confirm={props.confirm}
          senders={props.senders}
          openSenders={(connectionId) => page.open(sendersDetail(view.connector.id, connectionId))}
        />
      )
    }
  }
  if (shown.kind === "senders") {
    const view = views.find((item) => item.connector.id === shown.connectorId)
    if (view !== undefined) {
      return (
        <SenderPolicyPage
          t={t}
          view={view}
          connectionId={shown.connectionId}
          senders={props.senders}
          confirm={props.confirm}
        />
      )
    }
  }
  if (shown.kind === "accounts" && accounts.status === "ready") {
    const provider = accounts.snapshot.providers.find((item) => item.id === shown.provider)
    if (provider !== undefined) {
      return (
        <BotAccountsPage
          t={t}
          bot={bot}
          provider={provider}
          snapshot={accounts.snapshot}
          connections={connections}
          confirm={props.confirm}
          openGlobalSettings={props.openConnectionSettings}
        />
      )
    }
  }
  if (views.length === 0) {
    return (
      <EmptyState
        icon={<IconConnectors size={28} />}
        title={t("connectors.none")}
        marks={{ "data-dshb-connectors-none": "" }}
      />
    )
  }
  const { on, off } = connectorsByState(views)
  const list = (group: readonly BotConnectorView[]) =>
    group.map((view) => (
      <ConnectorRow
        key={view.connector.id}
        t={t}
        view={view}
        block={switchBlockOf(view, views, spec)}
        feed={feed}
        confirm={props.confirm}
        onOpen={() => page.open(connectorDetail(view.connector.id))}
      />
    ))
  return (
    <div className="dshb-settings-groups" data-dshb-connectors="">
      <ProviderRows
        t={t}
        bot={bot}
        ids={providerIdsOf(views)}
        accounts={accounts}
        views={views}
        onOpen={(provider) => page.open(accountsDetail(provider))}
      />
      {on.length > 0 && (
        <Group title={t("connectors.group.on")} marks={{ "data-dshb-connectors-on": "" }}>
          {list(on)}
        </Group>
      )}
      {off.length > 0 && (
        <Group title={t("connectors.group.off")} marks={{ "data-dshb-connectors-off": "" }}>
          {list(off)}
        </Group>
      )}
    </div>
  )
}

const STANDING: Readonly<
  Record<
    ProviderStanding["kind"],
    { readonly tone: "warning" | "idle" | "success"; readonly label: MessageKey }
  >
> = {
  unconfigured: { tone: "warning", label: "connections.standing.unconfigured" },
  reauth: { tone: "warning", label: "connections.standing.reauth" },
  none: { tone: "idle", label: "connections.standing.none" },
  connected: { tone: "success", label: "connections.standing.connected" },
}

function ProviderRows(props: {
  readonly t: Translate
  readonly bot: BotView
  readonly ids: readonly string[]
  readonly accounts: ConnectionsState
  readonly views: readonly BotConnectorView[]
  onOpen(provider: string): void
}) {
  const { t, bot, ids, accounts } = props
  if (ids.length === 0) return null
  if (accounts.status === "failed") {
    return (
      <Group title={t("connectors.group.accounts")}>
        <Row
          label={t("connections.unavailable", { message: accounts.failure.message })}
          metaTone="danger"
        />
      </Group>
    )
  }
  const providers: readonly (ConnectionProviderView | string)[] =
    accounts.status === "ready" ? providersOf(accounts.snapshot, props.views) : ids
  return (
    <Group title={t("connectors.group.accounts")} marks={{ "data-dshb-connectors-accounts": "" }}>
      {providers.map((provider) => {
        if (typeof provider === "string" || accounts.status !== "ready") {
          const id = typeof provider === "string" ? provider : provider.id
          return (
            <Row
              key={id}
              label={t("connections.loading")}
              trailing={<StatusPill tone="busy" label={t("connections.standing.loading")} />}
            />
          )
        }
        const standing = providerStanding(accounts.snapshot, provider, bot.id)
        const shown = STANDING[standing.kind]
        const count =
          standing.kind === "connected" || standing.kind === "reauth" ? standing.count : 0
        return (
          <NavRow
            key={provider.id}
            label={provider.name}
            meta={
              standing.kind === "unconfigured"
                ? undefined
                : localeFormat(t).count("connections.count", count)
            }
            trailing={
              <StatusPill
                tone={shown.tone}
                label={t(shown.label)}
                marks={{ "data-dshb-provider-standing": standing.kind }}
              />
            }
            onOpen={() => props.onOpen(provider.id)}
            marks={{ "data-dshb-provider": provider.id }}
          />
        )
      })}
    </Group>
  )
}

function ConnectorRow(props: {
  readonly t: Translate
  readonly view: BotConnectorView
  readonly block: ConnectorSwitchBlock | undefined
  readonly feed: ConnectorsFeed
  readonly confirm: SettingsSectionProps["confirm"]
  onOpen(): void
}) {
  const { t, view, block } = props
  const { connector } = view
  const saves = useConnectorSaves(props)
  const accounts = connectorAccounts(view)
  const accountsMeta =
    connector.connections === undefined
      ? undefined
      : accounts.some((account) => account.usable)
        ? accounts
            .filter((account) => account.usable)
            .map((account) => account.name)
            .join(", ")
        : t("connectors.accounts.none")
  return (
    <NavRow
      label={connector.name}
      meta={
        saves.error ??
        (block === undefined ? (
          accountsMeta
        ) : (
          <span data-dshb-connector-switch-block={block.kind}>
            {switchBlockText(t, connector.name, block)}
          </span>
        ))
      }
      metaTone={saves.error === null ? undefined : "danger"}
      onOpen={props.onOpen}
      marks={{ "data-dshb-connector": connector.id }}
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
    />
  )
}
