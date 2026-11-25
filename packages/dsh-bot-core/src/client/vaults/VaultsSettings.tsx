import { useState } from "react"
import type { VaultAccountView, VaultProviderView } from "../../shared/vaults"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { useObservable } from "../hooks"
import { IconKey } from "../icons"
import { localeFormat } from "../locale-format"
import { failureText } from "../settings/failure-text"
import type { Translate } from "../types"
import {
  AddRow,
  Button,
  commitWith,
  EmptyState,
  ErrorText,
  Group,
  LinkRow,
  Row,
  RowMenu,
  StatusPill,
  Tag,
  TextFieldRow,
  TextInput,
} from "../ui"
import type { VaultsFeed } from "./model"
import { kindsLabel, providerPill, type ResolveText } from "./text"

export interface VaultsSettingsDeps {
  readonly vaults: VaultsFeed
  readonly text: ResolveText
}

/** The dsh-bots settings of password managers: each provider's state and its connected accounts. */
export function VaultsSettings(props: GlobalSettingsSectionProps & VaultsSettingsDeps) {
  const { t, vaults } = props
  const state = useObservable(vaults)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("vaults.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("vaults.unavailable", { message: state.failure.message })}</ErrorText>
  }
  const { providers, accounts } = state.snapshot
  if (providers.length === 0) {
    return <EmptyState icon={<IconKey size={28} />} title={t("vaults.none")} />
  }
  return (
    <div className="dshb-settings-groups" data-dshb-vaults-settings="">
      {providers.map((provider) => (
        <ProviderGroup
          key={provider.id}
          {...props}
          provider={provider}
          accounts={accounts.filter((account) => account.provider === provider.id)}
        />
      ))}
    </div>
  )
}

function ProviderGroup(
  props: GlobalSettingsSectionProps &
    VaultsSettingsDeps & {
      readonly provider: VaultProviderView
      readonly accounts: readonly VaultAccountView[]
    },
) {
  const { t, provider, accounts } = props
  const [adding, setAdding] = useState(false)
  const pill = providerPill(t, provider.status)
  return (
    <Group
      title={provider.name}
      tag={provider.development ? <Tag>{t("vaults.dev")}</Tag> : undefined}
      marks={{ "data-dshb-vault-provider": provider.id }}
    >
      <Row
        label={t("vaults.provider.state")}
        meta={provider.status.state === "failed" ? provider.status.reason : undefined}
        metaTone={provider.status.state === "failed" ? "danger" : undefined}
        trailing={<StatusPill tone={pill.tone} label={pill.label} />}
      />
      <Row
        label={t("vaults.provider.kinds")}
        meta={kindsLabel(t, ["username", ...provider.kinds])}
      />
      {provider.guide !== undefined && <LinkRow label={t("vaults.guide")} href={provider.guide} />}
      {accounts.map((account) => (
        <AccountRow key={account.id} {...props} account={account} />
      ))}
      {adding ? (
        <AddAccount {...props} done={() => setAdding(false)} />
      ) : (
        <AddRow
          label={t("vaults.account.add")}
          onAdd={() => setAdding(true)}
          marks={{ "data-dshb-vault-add-account": provider.id }}
        />
      )}
    </Group>
  )
}

function AccountRow(
  props: GlobalSettingsSectionProps & VaultsSettingsDeps & { readonly account: VaultAccountView },
) {
  const { t, account, vaults, confirm } = props
  const [renaming, setRenaming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  if (renaming) {
    return (
      <TextFieldRow
        label={t("vaults.account.label")}
        value={account.label}
        commit={async (text) => {
          const result = await commitWith(
            () => vaults.renameAccount(account.id, text),
            (cause) => failureText(t, cause),
          )
          if (result.ok) setRenaming(false)
          return result
        }}
        marks={{ "data-dshb-vault-rename": account.id }}
      />
    )
  }
  const remove = async () => {
    const accepted = await confirm({
      title: t("vaults.confirm.remove.title", { account: account.label }),
      description: localeFormat(t).count("vaults.confirm.remove.description", account.bots.length),
      confirm: t("vaults.confirm.remove.accept"),
      tone: "danger",
    })
    if (!accepted) return
    try {
      await vaults.removeAccount(account.id)
    } catch (cause) {
      setFailure(failureText(t, cause))
    }
  }
  const bots =
    account.bots.length === 0
      ? t("vaults.account.none")
      : localeFormat(t).count("vaults.account.bots", account.bots.length)
  return (
    <Row
      label={account.label}
      meta={failure ?? account.statusReason ?? bots}
      metaTone={failure !== null || account.status === "error" ? "danger" : undefined}
      marks={{ "data-dshb-vault-account": account.id }}
      trailing={
        <>
          <StatusPill
            tone={account.status === "active" ? "success" : "danger"}
            label={t(`vaults.account.${account.status}`)}
          />
          <RowMenu
            label={t("vaults.account.menu", { account: account.label })}
            items={[
              { id: "rename", label: t("vaults.account.rename"), run: () => setRenaming(true) },
              {
                id: "remove",
                label: t("vaults.account.remove"),
                tone: "danger",
                run: () => void remove(),
              },
            ]}
          />
        </>
      }
    />
  )
}

function SecretInput(props: {
  readonly value: string
  onChange(value: string): void
  readonly label: string
  readonly marks?: Record<`data-${string}`, string>
}) {
  return (
    <span className="dshb-ui-field" data-width="fill">
      <input
        className="dshb-ui-field-input"
        type="password"
        autoComplete="off"
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        {...props.marks}
      />
    </span>
  )
}

function AddAccount(
  props: VaultsSettingsDeps & {
    readonly t: Translate
    readonly provider: VaultProviderView
    done(): void
  },
) {
  const { t, provider, vaults, text } = props
  const [label, setLabel] = useState(provider.name)
  const [values, setValues] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }))
  const connect = async () => {
    const missing = provider.setup.find(
      (field) => field.required && (values[field.key] ?? "").trim() === "",
    )
    if (missing !== undefined) {
      setFailure(t("vaults.account.required", { field: text(missing.label) }))
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await vaults.addAccount({ provider: provider.id, label, values })
      setValues({})
      props.done()
    } catch (cause) {
      setFailure(failureText(t, cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dshb-settings-groups" data-dshb-vault-account-form={provider.id}>
      <Row
        label={t("vaults.account.label")}
        trailing={
          <TextInput
            value={label}
            onChange={setLabel}
            label={t("vaults.account.label")}
            maxLength={60}
            marks={{ "data-dshb-vault-account-label": "" }}
          />
        }
      />
      {provider.setup.map((field) => (
        <Row
          key={field.key}
          label={text(field.label)}
          meta={field.help === undefined ? undefined : text(field.help)}
          trailing={
            field.kind === "secret" ? (
              <SecretInput
                value={values[field.key] ?? ""}
                onChange={(value) => set(field.key, value)}
                label={text(field.label)}
                marks={{ "data-dshb-vault-setup": field.key }}
              />
            ) : (
              <TextInput
                value={values[field.key] ?? ""}
                onChange={(value) => set(field.key, value)}
                label={text(field.label)}
                marks={{ "data-dshb-vault-setup": field.key }}
              />
            )
          }
        />
      ))}
      <Row
        label=""
        meta={failure ?? undefined}
        metaTone={failure === null ? undefined : "danger"}
        trailing={
          <>
            <Button variant="row" onClick={props.done} disabled={busy}>
              {t("vaults.account.cancel")}
            </Button>
            <Button
              variant="row"
              onClick={() => void connect()}
              disabled={busy || label.trim() === ""}
              marks={{ "data-dshb-vault-connect": provider.id }}
            >
              {busy ? t("vaults.account.connecting") : t("vaults.account.connect")}
            </Button>
          </>
        }
      />
    </div>
  )
}
