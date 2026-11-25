import { useEffect, useState } from "react"
import type { BotView } from "../../shared/bots"
import {
  type BotVaultView,
  VAULT_FIELD_KINDS,
  type VaultAccountView,
  type VaultFieldKind,
  type VaultFillerView,
  type VaultGrantView,
  type VaultIncidentView,
  type VaultItemView,
  type VaultUseView,
} from "../../shared/vaults"
import { useObservable } from "../hooks"
import { localeFormat } from "../locale-format"
import { failureText } from "../settings/failure-text"
import type { SettingsSectionProps } from "../settings/sections"
import type { Translate } from "../types"
import {
  AddRow,
  BlockRow,
  Button,
  ButtonRow,
  commitWith,
  ErrorText,
  Group,
  NavRow,
  PageTitle,
  Row,
  Select,
  StatusPill,
  Switch,
  TextArea,
  TextFieldRow,
  TextInput,
  useTextDraft,
} from "../ui"
import type { BotVaultFeed, BotVaultsHub, VaultsFeed } from "./model"
import { parseSites, sitesText } from "./sites"
import { kindLabel, kindsLabel } from "./text"

export interface LoginsSectionDeps {
  readonly logins: BotVaultsHub
  readonly vaults: VaultsFeed
  openVaultSettings(): void
}

const ADD_PAGE = "add"
const SHOWN_USES = 30

/** A bot's logins: what it may fill, their uses and the incidents of the leak guard. */
export function LoginsSection(props: SettingsSectionProps & LoginsSectionDeps) {
  const { t, bot, page } = props
  const feed = props.logins.feed(bot.id)
  const state = useObservable(feed)
  const vaults = useObservable(props.vaults)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("logins.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("logins.unavailable", { message: state.failure.message })}</ErrorText>
  }
  const accounts = vaults.status === "ready" ? vaults.snapshot.accounts : []
  const fillers = vaults.status === "ready" ? vaults.snapshot.fillers : []
  if (page.detail === ADD_PAGE) {
    return <AddLogin {...props} feed={feed} accounts={accounts} fillers={fillers} />
  }
  const grant = state.view.grants.find((each) => each.id === page.detail)
  if (grant !== undefined) {
    const account = accounts.find((each) => each.id === grant.accountId)
    const provider =
      vaults.status === "ready"
        ? vaults.snapshot.providers.find((each) => each.id === account?.provider)
        : undefined
    const offered: readonly VaultFieldKind[] = ["username", ...(provider?.kinds ?? [])]
    return <LoginDetail {...props} feed={feed} grant={grant} offered={offered} fillers={fillers} />
  }
  return <LoginsList {...props} view={state.view} feed={feed} accounts={accounts} />
}

function LoginsList(
  props: SettingsSectionProps &
    LoginsSectionDeps & {
      readonly view: BotVaultView
      readonly feed: BotVaultFeed
      readonly accounts: readonly VaultAccountView[]
    },
) {
  const { t, view, page, feed } = props
  const format = localeFormat(t)
  const now = Date.now()
  return (
    <div className="dshb-settings-groups" data-dshb-logins="">
      <Group title={t("logins.group")}>
        {view.grants.length === 0 && <Row label={t("logins.none")} />}
        {view.grants.map((grant) => (
          <NavRow
            key={grant.id}
            label={grant.label}
            meta={[
              kindsLabel(t, grant.kinds),
              grant.lastUsedAt === undefined
                ? t("logins.neverUsed")
                : t("logins.lastUsed", {
                    time: format.relative(grant.lastUsedAt, now, "largestUnit"),
                  }),
            ].join(" · ")}
            trailing={<GrantPill t={t} grant={grant} />}
            onOpen={() => page.open(grant.id)}
            marks={{ "data-dshb-login": grant.id }}
          />
        ))}
        {props.accounts.length === 0 ? (
          <Row
            label={t("logins.noAccount")}
            trailing={
              <Button variant="row" onClick={props.openVaultSettings}>
                {t("logins.openSettings")}
              </Button>
            }
          />
        ) : (
          <AddRow
            label={t("logins.add")}
            onAdd={() => page.open(ADD_PAGE)}
            marks={{ "data-dshb-login-add": "" }}
          />
        )}
      </Group>
      <Incidents t={t} incidents={view.incidents} grants={view.grants} feed={feed} />
      <Uses t={t} uses={view.uses} grants={view.grants} />
    </div>
  )
}

function GrantPill(props: { readonly t: Translate; readonly grant: VaultGrantView }) {
  const { t, grant } = props
  if (grant.availability === "missing")
    return <StatusPill tone="danger" label={t("logins.missing")} />
  if (grant.guard.some((each) => each.state === "stale")) {
    return <StatusPill tone="danger" label={t("logins.stale")} />
  }
  if (grant.guard.some((each) => each.state === "short")) {
    return <StatusPill tone="warning" label={t("logins.short")} />
  }
  return (
    <StatusPill
      tone={grant.availability === "available" ? "success" : "idle"}
      label={t("logins.available")}
    />
  )
}

function Incidents(props: {
  readonly t: Translate
  readonly incidents: readonly VaultIncidentView[]
  readonly grants: readonly VaultGrantView[]
  readonly feed: BotVaultFeed
}) {
  const { t, feed } = props
  const format = localeFormat(t)
  const [failure, setFailure] = useState<string | null>(null)
  return (
    <Group title={t("logins.incidents")} marks={{ "data-dshb-login-incidents": "" }}>
      {props.incidents.length === 0 && <Row label={t("logins.incidents.none")} />}
      {failure !== null && <Row label="" meta={failure} metaTone="danger" />}
      {props.incidents.map((incident) => (
        <Row
          key={incident.id}
          label={t(
            incident.source === "inbound-message"
              ? "logins.incident.text.inbound"
              : `logins.incident.text.${incident.outcome}`,
            {
              kind: kindLabel(t, incident.kind),
              login: incident.label,
              tool: incident.tool ?? "",
            },
          )}
          meta={
            incident.repeats === undefined
              ? format.instant(incident.at, "dateTime")
              : t("logins.incident.repeats", {
                  time: format.instant(incident.lastAt ?? incident.at, "dateTime"),
                  count: format.number(incident.repeats + 1),
                })
          }
          marks={{ "data-dshb-login-incident": incident.id }}
          trailing={
            <>
              <StatusPill
                tone={incident.outcome === "exposed" ? "danger" : "warning"}
                label={t(`logins.incident.${incident.outcome}`)}
              />
              {incident.acknowledgedAt === undefined ? (
                <Button
                  variant="row"
                  onClick={() => {
                    setFailure(null)
                    feed
                      .acknowledge(incident.id)
                      .catch((cause: unknown) => setFailure(failureText(t, cause)))
                  }}
                  marks={{ "data-dshb-login-acknowledge": incident.id }}
                >
                  {t("logins.incident.acknowledge")}
                </Button>
              ) : (
                <StatusPill tone="idle" label={t("logins.incident.acknowledged")} />
              )}
            </>
          }
        />
      ))}
    </Group>
  )
}

function Uses(props: {
  readonly t: Translate
  readonly uses: readonly VaultUseView[]
  readonly grants: readonly VaultGrantView[]
}) {
  const { t } = props
  const format = localeFormat(t)
  const labelOf = (grantId: string) =>
    props.grants.find((grant) => grant.id === grantId)?.label ?? grantId
  return (
    <Group title={t("logins.uses")} marks={{ "data-dshb-login-uses": "" }}>
      {props.uses.length === 0 && <Row label={t("logins.uses.none")} />}
      {props.uses.slice(0, SHOWN_USES).map((use) => (
        <Row
          key={use.id}
          density="compact"
          label={`${labelOf(use.grantId)} · ${kindLabel(t, use.kind)}`}
          meta={[
            use.target.kind === "browser" ? use.target.origin : use.target.application,
            use.tool,
            format.instant(use.at, "dateTime"),
            ...(use.reason === undefined ? [] : [use.reason]),
          ].join(" · ")}
          trailing={
            <StatusPill
              tone={use.outcome === "filled" ? "success" : "danger"}
              label={t(`logins.use.${use.outcome}`)}
            />
          }
        />
      ))}
    </Group>
  )
}

function ConnectorSwitches(props: {
  readonly t: Translate
  readonly fillers: readonly VaultFillerView[]
  readonly chosen: readonly string[]
  onChange(connectors: string[]): void
}) {
  const { t, fillers, chosen } = props
  const shown = [
    ...fillers,
    ...chosen
      .filter((id) => !fillers.some((filler) => filler.id === id))
      .map((id) => ({ id, name: id })),
  ]
  if (shown.length === 0) return <Row label={t("logins.connectors.none")} />
  return (
    <>
      {shown.map((filler) => (
        <Row
          key={filler.id}
          label={filler.name}
          trailing={
            <Switch
              checked={chosen.includes(filler.id)}
              label={filler.name}
              onChange={(on) =>
                props.onChange(
                  on ? [...chosen, filler.id] : chosen.filter((id) => id !== filler.id),
                )
              }
              marks={{ "data-dshb-login-connector": filler.id }}
            />
          }
        />
      ))}
    </>
  )
}

function KindSwitches(props: {
  readonly t: Translate
  readonly offered: readonly VaultFieldKind[]
  readonly chosen: readonly VaultFieldKind[]
  onChange(kinds: VaultFieldKind[]): void
}) {
  const { t, offered, chosen } = props
  return (
    <>
      {VAULT_FIELD_KINDS.filter((kind) => offered.includes(kind)).map((kind) => (
        <Row
          key={kind}
          label={kindLabel(t, kind)}
          trailing={
            <Switch
              checked={chosen.includes(kind)}
              label={kindLabel(t, kind)}
              onChange={(on) =>
                props.onChange(
                  VAULT_FIELD_KINDS.filter((each) => (each === kind ? on : chosen.includes(each))),
                )
              }
              marks={{ "data-dshb-login-kind": kind }}
            />
          }
        />
      ))}
    </>
  )
}

function LoginDetail(
  props: SettingsSectionProps &
    LoginsSectionDeps & {
      readonly feed: BotVaultFeed
      readonly grant: VaultGrantView
      readonly offered: readonly VaultFieldKind[]
      readonly fillers: readonly VaultFillerView[]
    },
) {
  const { t, grant, feed, page, bot, confirm } = props
  const [failure, setFailure] = useState<string | null>(null)
  const sites = useTextDraft({
    value: sitesText(grant.sites),
    commit: (text) =>
      commitWith(
        () => feed.updateGrant(grant.id, { sites: parseSites(text) }),
        (cause) => failureText(t, cause),
      ),
  })
  const save = (change: Parameters<BotVaultFeed["updateGrant"]>[1]) => {
    setFailure(null)
    feed.updateGrant(grant.id, change).catch((cause: unknown) => setFailure(failureText(t, cause)))
  }
  const revoke = async (subject: BotView) => {
    const accepted = await confirm({
      title: t("logins.confirm.revoke.title", { login: grant.label }),
      description: t("logins.confirm.revoke.description", { bot: subject.name }),
      confirm: t("logins.confirm.revoke.accept"),
      tone: "danger",
    })
    if (!accepted) return
    try {
      await feed.revoke(grant.id)
      page.back()
    } catch (cause) {
      setFailure(failureText(t, cause))
    }
  }
  return (
    <div className="dshb-settings-groups" data-dshb-login-detail={grant.id}>
      <PageTitle tag={<GrantPill t={t} grant={grant} />}>{grant.label}</PageTitle>
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      {grant.guard.some((each) => each.state === "stale") && (
        <Group>
          <Row
            label={t("logins.stale")}
            trailing={
              <Button
                variant="row"
                onClick={() => save({})}
                marks={{ "data-dshb-login-refingerprint": grant.id }}
              >
                {t("logins.refingerprint")}
              </Button>
            }
          />
        </Group>
      )}
      <Group>
        <TextFieldRow
          label={t("logins.name")}
          value={grant.label}
          commit={(text) =>
            commitWith(
              () => feed.updateGrant(grant.id, { label: text }),
              (cause) => failureText(t, cause),
            )
          }
        />
        <Row
          label={t("logins.showUsername")}
          trailing={
            <Switch
              checked={grant.showUsername}
              label={t("logins.showUsername")}
              onChange={(showUsername) => save({ showUsername })}
            />
          }
        />
        <Row
          label={t("logins.desktop")}
          trailing={
            <Switch
              checked={grant.desktop}
              label={t("logins.desktop")}
              onChange={(desktop) => save({ desktop })}
              marks={{ "data-dshb-login-desktop": "" }}
            />
          }
        />
      </Group>
      <Group title={t("logins.fields")}>
        <KindSwitches
          t={t}
          offered={props.offered}
          chosen={grant.kinds}
          onChange={(kinds) => save({ kinds })}
        />
      </Group>
      <Group title={t("logins.connectors")}>
        <ConnectorSwitches
          t={t}
          fillers={props.fillers}
          chosen={grant.connectors}
          onChange={(connectors) => save({ connectors })}
        />
      </Group>
      <Group title={t("logins.sites")}>
        <BlockRow label={t("logins.sites")} meta={t("logins.sites.hint")}>
          <TextArea
            draft={sites}
            label={t("logins.sites")}
            marks={{ "data-dshb-login-sites": "" }}
          />
        </BlockRow>
      </Group>
      <Group>
        <ButtonRow
          label={t("logins.remove")}
          tone="danger"
          onClick={() => void revoke(bot)}
          marks={{ "data-dshb-login-remove": grant.id }}
        />
      </Group>
    </div>
  )
}

function AddLogin(
  props: SettingsSectionProps &
    LoginsSectionDeps & {
      readonly feed: BotVaultFeed
      readonly accounts: readonly VaultAccountView[]
      readonly fillers: readonly VaultFillerView[]
    },
) {
  const { t, page, feed, accounts } = props
  const [connectors, setConnectors] = useState<string[]>([])
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "")
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<readonly VaultItemView[] | null>(null)
  const [item, setItem] = useState<VaultItemView | null>(null)
  const [kinds, setKinds] = useState<VaultFieldKind[]>([])
  const [label, setLabel] = useState("")
  const [sites, setSites] = useState("")
  const [desktop, setDesktop] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (accountId === "") return
    let current = true
    setItems(null)
    const timer = setTimeout(() => {
      props.vaults.listItems(accountId, query).then(
        (found) => {
          if (current) setItems(found)
        },
        (cause: unknown) => {
          if (current) setFailure(failureText(t, cause))
        },
      )
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [accountId, query, props.vaults, t])

  const choose = (picked: VaultItemView) => {
    setItem(picked)
    setKinds(picked.kinds.filter((kind) => kind !== "passkey"))
    setLabel(picked.title.slice(0, 60))
    setSites(
      sitesText(
        picked.websites.flatMap((website) => {
          try {
            const origin = new URL(website).origin
            return origin.startsWith("https://") ? [{ origin, subdomains: false }] : []
          } catch {
            return []
          }
        }),
      ),
    )
  }
  const save = async () => {
    if (item === null) return
    if (kinds.length === 0) {
      setFailure(t("logins.add.noFields"))
      return
    }
    if (connectors.length === 0) {
      setFailure(t("logins.add.noConnectors"))
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      const grant = await feed.grant({
        accountId: item.accountId,
        vaultId: item.vaultId,
        itemId: item.itemId,
        label,
        kinds,
        connectors,
        sites: parseSites(sites),
        desktop,
      })
      page.open(grant.id)
    } catch (cause) {
      setFailure(failureText(t, cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dshb-settings-groups" data-dshb-login-add-page="">
      <PageTitle>{t("logins.add")}</PageTitle>
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      {item === null ? (
        <Group>
          <Row
            label={t("logins.add.account")}
            trailing={
              <Select
                value={accountId}
                label={t("logins.add.account")}
                choices={accounts.map((account) => ({ value: account.id, label: account.label }))}
                onChange={setAccountId}
              />
            }
          />
          <Row
            label={t("logins.add.search")}
            trailing={
              <TextInput
                value={query}
                onChange={setQuery}
                label={t("logins.add.search")}
                marks={{ "data-dshb-login-search": "" }}
              />
            }
          />
          {items === null && <Row label={t("logins.add.searching")} />}
          {items?.length === 0 && <Row label={t("logins.add.noItems")} />}
          {items?.map((found) => (
            <Row
              key={`${found.vaultId}/${found.itemId}`}
              label={found.title}
              meta={[found.username, found.vaultName, ...found.websites]
                .filter(Boolean)
                .join(" · ")}
              marks={{ "data-dshb-login-item": found.itemId }}
              trailing={
                <Button variant="row" onClick={() => choose(found)}>
                  {t("logins.add.choose")}
                </Button>
              }
            />
          ))}
        </Group>
      ) : (
        <>
          <Group>
            <Row
              label={t("logins.name")}
              trailing={
                <TextInput
                  value={label}
                  onChange={setLabel}
                  label={t("logins.name")}
                  maxLength={60}
                />
              }
            />
            <Row
              label={t("logins.desktop")}
              trailing={
                <Switch checked={desktop} label={t("logins.desktop")} onChange={setDesktop} />
              }
            />
          </Group>
          <Group title={t("logins.fields")}>
            <KindSwitches t={t} offered={item.kinds} chosen={kinds} onChange={setKinds} />
          </Group>
          <Group title={t("logins.connectors")}>
            <ConnectorSwitches
              t={t}
              fillers={props.fillers}
              chosen={connectors}
              onChange={setConnectors}
            />
          </Group>
          <Group title={t("logins.sites")}>
            <BlockRow label={t("logins.sites")} meta={t("logins.sites.hint")}>
              <textarea
                className="dshb-ui-textarea"
                aria-label={t("logins.sites")}
                rows={3}
                spellCheck={false}
                value={sites}
                onChange={(event) => setSites(event.currentTarget.value)}
                data-dshb-login-sites=""
              />
            </BlockRow>
          </Group>
          <Group>
            <Row
              label={item.title}
              meta={item.vaultName}
              trailing={
                <>
                  <Button variant="row" onClick={() => setItem(null)} disabled={busy}>
                    {t("logins.add.cancel")}
                  </Button>
                  <Button
                    variant="row"
                    onClick={() => void save()}
                    disabled={busy}
                    marks={{ "data-dshb-login-save": "" }}
                  >
                    {busy ? t("logins.add.saving") : t("logins.add.save")}
                  </Button>
                </>
              }
            />
          </Group>
        </>
      )}
    </div>
  )
}
