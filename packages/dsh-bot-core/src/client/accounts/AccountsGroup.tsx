import { useState } from "react"
import type { BotView } from "../../shared/bots"
import type {
  BotConnectionsSnapshot,
  ConnectionAttemptView,
  ConnectionProviderView,
  ConnectionView,
} from "../../shared/connections"
import { MAX_CONNECTION_LABEL } from "../../shared/connections"
import type { ConnectionsFeed } from "../connections-model"
import { accountLabel } from "../connections-view"
import type { MessageKey } from "../i18n"
import { localeFormat } from "../locale-format"
import { failureText } from "../settings/failure-text"
import type { FrameSectionProps } from "../settings-frame/sections"
import type { Translate } from "../types"
import {
  AddRow,
  Button,
  type CommitResult,
  commitWith,
  Group,
  LinkRow,
  Row,
  StatusPill,
  Switch,
} from "../ui"
import type { PillTone } from "../ui/StatusPill"
import { AccountRow } from "./AccountRow"
import { type SignInRequest, useSignIn } from "./sign-in"

export interface AccountsGroupProps {
  readonly t: Translate
  readonly provider: ConnectionProviderView
  readonly snapshot: BotConnectionsSnapshot
  readonly connections: ConnectionsFeed
  readonly confirm: FrameSectionProps["confirm"]
  readonly bot?: BotView
}

const ATTEMPT: Readonly<
  Record<
    ConnectionAttemptView["state"]["kind"],
    { readonly tone: PillTone; readonly label: MessageKey; readonly state: MessageKey }
  >
> = {
  waiting: {
    tone: "busy",
    label: "connections.attempt.waiting",
    state: "connections.attempt.state.waiting",
  },
  exchanging: {
    tone: "busy",
    label: "connections.attempt.exchanging",
    state: "connections.attempt.state.exchanging",
  },
  connected: {
    tone: "success",
    label: "connections.attempt.connected",
    state: "connections.attempt.state.connected",
  },
  failed: {
    tone: "danger",
    label: "connections.attempt.failed",
    state: "connections.attempt.state.failed",
  },
}

export function AccountsGroup({
  t,
  provider,
  snapshot,
  connections,
  confirm,
  bot,
}: AccountsGroupProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const signIn = useSignIn({
    provider,
    connections,
    snapshot,
    ...(bot === undefined ? {} : { botId: bot.id }),
  })
  const mine = snapshot.connections.filter((connection) => connection.provider === provider.id)
  const accounts =
    bot === undefined
      ? mine
      : [
          ...mine.filter((connection) => connection.bots.includes(bot.id)),
          ...mine.filter((connection) => !connection.bots.includes(bot.id)),
        ]

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await work()
    } catch (cause) {
      setError(failureText(t, cause))
    } finally {
      setBusy(false)
    }
  }
  const start = (request: SignInRequest) => run(() => signIn.start(request))
  const disconnect = (connection: ConnectionView) =>
    run(async () => {
      const confirmed = await confirm({
        title: t("connections.confirm.disconnect.title", { account: accountLabel(connection) }),
        description: localeFormat(t).count(
          "connections.confirm.disconnect.description",
          connection.bots.length,
          { provider: provider.name },
        ),
        confirm: t("connections.confirm.disconnect.accept"),
        tone: "danger",
      })
      if (!confirmed) return
      const removal = await connections.disconnect(connection.id)
      if (!removal.revoked && removal.reason !== undefined) {
        setNotice(t("connections.removed.unconfirmed", { reason: removal.reason }))
      }
    })
  const rename = (connection: ConnectionView, label: string): Promise<CommitResult> =>
    commitWith(
      () => connections.rename(connection.id, label),
      (cause) => failureText(t, cause),
    )
  const attempt = signIn.attempt
  return (
    <>
      <Group title={t("connections.group")} marks={{ "data-dshb-connections": provider.id }}>
        {accounts.length === 0 && (
          <Row label={t("connections.none")} marks={{ "data-dshb-connections-none": "" }} />
        )}
        {accounts.map((connection) => (
          <AccountRow
            key={connection.id}
            t={t}
            connection={connection}
            busy={busy}
            {...(bot === undefined
              ? {}
              : {
                  assignment: {
                    assigned: connection.bots.includes(bot.id),
                    onChange: (assigned: boolean) =>
                      void run(() => connections.assign(bot.id, connection.id, assigned)),
                  },
                })}
            rename={(label) => rename(connection, label)}
            signInAgain={() =>
              void start({
                services:
                  connection.services.length > 0
                    ? connection.services
                    : provider.services.map((service) => service.connectorId),
                connectionId: connection.id,
              })
            }
            disconnect={() => void disconnect(connection)}
          />
        ))}
        {attempt !== undefined && attempt.state.kind !== "connected" && (
          <Row
            label={t(ATTEMPT[attempt.state.kind].label)}
            meta={attempt.state.kind === "failed" ? attempt.state.reason : undefined}
            metaTone={attempt.state.kind === "failed" ? "danger" : undefined}
            trailing={
              <StatusPill
                tone={ATTEMPT[attempt.state.kind].tone}
                label={t(ATTEMPT[attempt.state.kind].state)}
              />
            }
            marks={{ "data-dshb-connections-attempt": attempt.state.kind }}
          />
        )}
        {signIn.link !== undefined && (
          <LinkRow
            label={t("connections.connect.link", { provider: provider.name })}
            meta={t("connections.connect.blocked")}
            href={signIn.link}
          />
        )}
        {notice !== null && <Row label={notice} />}
        {error !== null && (
          <Row
            label={<span className="dshb-ui-error">{error}</span>}
            marks={{ "data-dshb-connections-error": "" }}
          />
        )}
        {bot !== undefined && provider.client.configured && !adding && (
          <AddRow
            label={t("connections.add")}
            disabled={busy}
            onAdd={() => setAdding(true)}
            marks={{ "data-dshb-connections-add": "" }}
          />
        )}
      </Group>
      {adding && (
        <Group title={t("connections.add")} marks={{ "data-dshb-connections-adding": "" }}>
          <AddAccount
            t={t}
            provider={provider}
            busy={busy || signIn.starting}
            onCancel={() => setAdding(false)}
            onStart={(request) => void start(request).then(() => setAdding(false))}
          />
        </Group>
      )}
    </>
  )
}

function AddAccount(props: {
  readonly t: Translate
  readonly provider: ConnectionProviderView
  readonly busy: boolean
  onCancel(): void
  onStart(request: SignInRequest): void
}) {
  const { t, provider, busy } = props
  const [services, setServices] = useState<readonly string[]>(
    provider.services.map((service) => service.connectorId),
  )
  const [label, setLabel] = useState("")
  return (
    <>
      {provider.services.map((service) => (
        <Row
          key={service.connectorId}
          label={service.name}
          trailing={
            <Switch
              checked={services.includes(service.connectorId)}
              label={t("connections.connect.grant", { service: service.name })}
              disabled={busy}
              onChange={(granted) =>
                setServices(
                  granted
                    ? [...services, service.connectorId]
                    : services.filter((item) => item !== service.connectorId),
                )
              }
              marks={{ "data-dshb-connect-service": service.connectorId }}
            />
          }
        />
      ))}
      <Row
        label={t("connections.connect.label")}
        trailing={
          <span className="dshb-ui-field">
            <input
              className="dshb-ui-field-input"
              aria-label={t("connections.connect.label")}
              placeholder={t("connections.connect.labelPlaceholder")}
              maxLength={MAX_CONNECTION_LABEL}
              value={label}
              disabled={busy}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </span>
        }
      />
      <div className="dshb-ui-row dshb-connect-actions" data-kind="plain">
        <Button variant="secondary" disabled={busy} onClick={props.onCancel}>
          {t("form.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={busy || services.length === 0}
          onClick={() =>
            props.onStart({ services, ...(label.trim() === "" ? {} : { label: label.trim() }) })
          }
          marks={{ "data-dshb-connect": "" }}
        >
          {busy
            ? t("connections.connect.starting")
            : t("connections.connect.start", { provider: provider.name })}
        </Button>
      </div>
    </>
  )
}
