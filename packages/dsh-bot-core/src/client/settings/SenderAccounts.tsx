import type { BotConnectorView } from "../../shared/connectors"
import type { SenderPolicyView } from "../../shared/senders"
import { useObservable } from "../hooks"
import { localeFormat } from "../locale-format"
import type { SendersFeed } from "../senders/model"
import type { Translate } from "../types"
import { Group, NavRow, Row, Tag } from "../ui"

export function policySummary(t: Translate, view: SenderPolicyView | undefined): string {
  const policy = view?.policy
  if (policy === undefined) return t("senders.account.summary.missing")
  const rules = localeFormat(t).count("senders.ruleCount", policy.rules.length)
  return t(`senders.account.summary.${policy.unknown}`, { rules })
}

export function SenderAccounts(props: {
  readonly t: Translate
  readonly view: BotConnectorView
  readonly senders: SendersFeed
  open(connectionId: string): void
}) {
  const { t, view } = props
  const state = useObservable(props.senders)
  const granted = (view.accounts ?? []).filter((account) => account.granted)
  if (granted.length === 0) return null
  return (
    <Group title={t("senders.group")} marks={{ "data-dshb-sender-accounts": "" }}>
      <Row label={t("senders.group.description")} density="compact" />
      {state.status === "failed" && (
        <Row label={t("senders.page.unavailable", { message: state.message })} metaTone="danger" />
      )}
      {granted.map((account) => {
        const policy =
          state.status === "ready"
            ? state.snapshot.accounts.find((item) => item.connectionId === account.connectionId)
            : undefined
        const name = account.email ?? account.label
        const waiting = policy?.inquiries.length ?? 0
        return (
          <NavRow
            key={account.connectionId}
            label={name}
            meta={state.status === "ready" ? policySummary(t, policy) : undefined}
            metaTone={
              state.status === "ready" && policy?.policy === undefined ? "danger" : undefined
            }
            description={t("senders.account.open", { account: name })}
            trailing={
              waiting > 0 ? (
                <Tag marks={{ "data-dshb-sender-waiting": "" }}>{String(waiting)}</Tag>
              ) : undefined
            }
            onOpen={() => props.open(account.connectionId)}
            marks={{ "data-dshb-sender-account": account.connectionId }}
          />
        )
      })}
    </Group>
  )
}
