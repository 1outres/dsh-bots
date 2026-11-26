import { useState } from "react"
import type { BotConnectorView } from "../../shared/connectors"
import {
  checkSenderMatch,
  coversFreemail,
  domainOfMatch,
  MAX_SENDER_RECIPIENT_SCAN,
  SENDER_UNKNOWNS,
  type SenderChoice,
  type SenderMatch,
  type SenderMatchKind,
  type SenderPolicy,
  type SenderPolicyView,
  type SenderRecipientsView,
  type SenderRule,
  type SenderUnknown,
  type SenderVerdict,
  sameSenderMatch,
  senderRuleFor,
} from "../../shared/senders"
import { useNow, useObservable } from "../hooks"
import { IconTrash } from "../icons"
import { localeFormat } from "../locale-format"
import { InquiryCard } from "../senders/InquiryCard"
import type { AnswerOutcome } from "../senders/inquiries"
import type { SendersFeed } from "../senders/model"
import { originText } from "../senders/texts"
import type { Translate } from "../types"
import {
  AddRow,
  BlockRow,
  Button,
  type Choice,
  ErrorText,
  Group,
  PageTitle,
  Row,
  Segmented,
  Select,
  Switch,
  TextInput,
} from "../ui"
import { failureText } from "./failure-text"
import type { SettingsSectionProps } from "./sections"

export interface SenderPolicyPageProps {
  readonly t: Translate
  readonly view: BotConnectorView
  readonly connectionId: string
  readonly senders: SendersFeed
  readonly confirm: SettingsSectionProps["confirm"]
}

const matchText = (match: SenderMatch) => match.value

function verdictChoices(t: Translate): readonly Choice<SenderVerdict>[] {
  return [
    { value: "allow", label: t("senders.rule.allow") },
    { value: "deny", label: t("senders.rule.deny") },
  ]
}

function kindChoices(t: Translate): readonly Choice<SenderMatchKind>[] {
  return [
    { value: "address", label: t("senders.add.address") },
    { value: "domain", label: t("senders.add.domain") },
  ]
}

function useSave(t: Translate) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await work()
    } catch (cause) {
      setError(t("senders.failed", { message: failureText(t, cause) }))
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function SenderPolicyPage(props: SenderPolicyPageProps) {
  const { t, senders, connectionId } = props
  const state = useObservable(senders)
  const save = useSave(t)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("senders.page.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("senders.page.unavailable", { message: state.message })}</ErrorText>
  }
  const account = state.snapshot.accounts.find((item) => item.connectionId === connectionId)
  if (account === undefined) return <ErrorText>{t("senders.page.gone")}</ErrorText>
  const others = state.snapshot.accounts.filter((item) => item.connectionId !== connectionId)
  return (
    <div className="dshb-settings-groups" data-dshb-sender-policy={connectionId}>
      <PageTitle>{t("senders.page.title", { account: account.account })}</PageTitle>
      {save.error !== null && (
        <p className="dshb-ui-error" role="alert">
          {save.error}
        </p>
      )}
      <UnknownGroup
        t={t}
        account={account}
        busy={save.busy}
        pick={(unknown) => void save.run(() => senders.setUnknown(connectionId, unknown))}
      />
      {account.inquiries.length > 0 && (
        <InquiriesGroup t={t} account={account} answer={answerOf(senders)} />
      )}
      {account.policy !== undefined && (
        <>
          <RulesGroup t={t} policy={account.policy} connectionId={connectionId} senders={senders} />
          <RecipientsGroup
            t={t}
            connectorId={props.view.connector.id}
            connectionId={connectionId}
            policy={account.policy}
            senders={senders}
          />
          <CopyGroup
            t={t}
            account={account}
            policy={account.policy}
            others={others}
            senders={senders}
            confirm={props.confirm}
          />
        </>
      )}
    </div>
  )
}

function answerOf(senders: SendersFeed) {
  return async (inquiryId: string, choice: SenderChoice): Promise<AnswerOutcome> => {
    try {
      return { kind: "result", result: await senders.answer(inquiryId, choice) }
    } catch (error) {
      return {
        kind: "unreachable",
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function UnknownGroup(props: {
  readonly t: Translate
  readonly account: SenderPolicyView
  readonly busy: boolean
  pick(unknown: SenderUnknown): void
}) {
  const { t, account } = props
  const unknown = account.policy?.unknown
  return (
    <Group title={t("senders.unknown.label")} marks={{ "data-dshb-sender-unknown-group": "" }}>
      <Row label={t("senders.page.shared", { account: account.account })} density="compact" />
      {unknown === undefined && (
        <Row label={t("senders.unknown.missing")} metaTone="danger" density="compact" />
      )}
      <BlockRow label={t("senders.unknown.label")}>
        <Segmented
          value={unknown ?? "ask"}
          choices={SENDER_UNKNOWNS.map((value) => ({
            value,
            label: t(`senders.unknown.${value}`),
            title: t(`senders.unknown.${value}.description`),
          }))}
          label={t("senders.unknown.label")}
          disabled={props.busy}
          onChange={props.pick}
          marks={{ "data-dshb-sender-unknown": unknown ?? "missing" }}
        />
      </BlockRow>
      {unknown !== undefined && (
        <Row label={t(`senders.unknown.${unknown}.description`)} density="compact" />
      )}
      {unknown !== "allow" && (
        <Row
          label={t("senders.unknown.past")}
          metaTone="warning"
          density="compact"
          marks={{ "data-dshb-sender-past": "" }}
        />
      )}
      <Row label={t("senders.unverified")} density="compact" />
    </Group>
  )
}

function InquiriesGroup(props: {
  readonly t: Translate
  readonly account: SenderPolicyView
  answer(inquiryId: string, choice: SenderChoice): Promise<AnswerOutcome>
}) {
  const now = useNow(true)
  return (
    <Group title={props.t("senders.inquiries")} marks={{ "data-dshb-sender-inquiries-group": "" }}>
      <div className="dshb-actions-open">
        {props.account.inquiries.map((inquiry) => (
          <InquiryCard
            key={inquiry.id}
            t={props.t}
            inquiry={inquiry}
            now={now}
            answer={props.answer}
          />
        ))}
      </div>
    </Group>
  )
}

function RulesGroup(props: {
  readonly t: Translate
  readonly policy: SenderPolicy
  readonly connectionId: string
  readonly senders: SendersFeed
}) {
  const { t, policy, connectionId, senders } = props
  const save = useSave(t)
  const [adding, setAdding] = useState(false)
  const format = localeFormat(t)
  const rules = [...policy.rules].sort(
    (a, b) =>
      a.match.kind.localeCompare(b.match.kind) || a.match.value.localeCompare(b.match.value),
  )
  const change = (rule: SenderRule, verdict: SenderVerdict) =>
    void save.run(() => senders.putRules(connectionId, [{ match: rule.match, verdict }]))
  const remove = (rule: SenderRule) =>
    void save.run(() => senders.removeRule(connectionId, rule.match))
  return (
    <Group title={t("senders.rules")} marks={{ "data-dshb-sender-rules": "" }}>
      {save.error !== null && <Row label={save.error} metaTone="danger" density="compact" />}
      {rules.length === 0 && <Row label={t("senders.rules.none")} density="compact" />}
      {rules.map((rule) => {
        const warning =
          rule.verdict === "allow" && coversFreemail(rule.match)
            ? t("senders.rule.freemail", { domain: domainOfMatch(rule.match) })
            : undefined
        const decided = t("senders.rule.decided", {
          at: format.instant(rule.decidedAt, "dateTime"),
          origin: originText(t, rule.origin),
        })
        return (
          <Row
            key={`${rule.match.kind}:${rule.match.value}`}
            label={matchText(rule.match)}
            meta={warning === undefined ? decided : `${warning} · ${decided}`}
            {...(warning === undefined ? {} : { metaTone: "warning" as const })}
            description={t("senders.rule.removed", { match: matchText(rule.match) })}
            marks={{ "data-dshb-sender-rule": rule.match.value }}
            trailing={
              <>
                <Segmented
                  value={rule.verdict}
                  choices={verdictChoices(t)}
                  label={t("senders.rule.verdict", { match: matchText(rule.match) })}
                  disabled={save.busy}
                  onChange={(verdict) => change(rule, verdict)}
                  marks={{ "data-dshb-sender-rule-verdict": rule.match.value }}
                />
                <Button
                  variant="icon"
                  label={t("senders.rule.remove", { match: matchText(rule.match) })}
                  disabled={save.busy}
                  onClick={() => remove(rule)}
                  marks={{ "data-dshb-sender-rule-remove": rule.match.value }}
                >
                  <IconTrash size={14} />
                </Button>
              </>
            }
          />
        )
      })}
      {adding ? (
        <RuleDraft
          t={t}
          policy={policy}
          busy={save.busy}
          cancel={() => setAdding(false)}
          add={(match, verdict) =>
            void save
              .run(() => senders.putRules(connectionId, [{ match, verdict }]))
              .then((saved) => {
                if (saved !== undefined) setAdding(false)
              })
          }
        />
      ) : (
        <AddRow
          label={t("senders.add")}
          onAdd={() => setAdding(true)}
          marks={{ "data-dshb-sender-rule-add": "" }}
        />
      )}
    </Group>
  )
}

function RuleDraft(props: {
  readonly t: Translate
  readonly policy: SenderPolicy
  readonly busy: boolean
  cancel(): void
  add(match: SenderMatch, verdict: SenderVerdict): void
}) {
  const { t } = props
  const [kind, setKind] = useState<SenderMatchKind>("address")
  const [value, setValue] = useState("")
  const [verdict, setVerdict] = useState<SenderVerdict>("allow")
  const checked = checkSenderMatch({ kind, value })
  const exists =
    checked.ok && props.policy.rules.some((rule) => sameSenderMatch(rule.match, checked.match))
  const problem =
    value.trim() === ""
      ? undefined
      : !checked.ok
        ? t(kind === "address" ? "senders.add.invalid.address" : "senders.add.invalid.domain")
        : exists
          ? t("senders.add.exists")
          : verdict === "allow" && coversFreemail(checked.match)
            ? t("senders.rule.freemail", { domain: domainOfMatch(checked.match) })
            : undefined
  const blocked = !checked.ok || exists
  return (
    <BlockRow label={t("senders.add")} marks={{ "data-dshb-sender-rule-draft": "" }}>
      <div className="dshb-tools-exception-draft">
        <Select
          value={kind}
          choices={kindChoices(t)}
          label={t("senders.add.kind")}
          disabled={props.busy}
          onChange={(picked) => setKind(picked)}
          marks={{ "data-dshb-sender-rule-kind": "" }}
        />
        <TextInput
          value={value}
          onChange={setValue}
          label={t("senders.add.value")}
          placeholder={t(
            kind === "address"
              ? "senders.add.placeholder.address"
              : "senders.add.placeholder.domain",
          )}
          disabled={props.busy}
          autoFocus
          marks={{ "data-dshb-sender-rule-value": "" }}
        />
        <Segmented
          value={verdict}
          choices={verdictChoices(t)}
          label={t("senders.add")}
          disabled={props.busy}
          onChange={(picked) => setVerdict(picked)}
          marks={{ "data-dshb-sender-rule-new-verdict": "" }}
        />
        <Button variant="secondary" onClick={props.cancel} disabled={props.busy}>
          {t("form.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={props.busy || blocked}
          onClick={() => {
            if (checked.ok && !exists) props.add(checked.match, verdict)
          }}
          marks={{ "data-dshb-sender-rule-submit": "" }}
        >
          {t("senders.add.submit")}
        </Button>
      </div>
      {problem !== undefined && (
        <p className="dshb-ui-row-meta" data-tone={blocked ? "danger" : "warning"} role="status">
          {problem}
        </p>
      )}
    </BlockRow>
  )
}

function RecipientsGroup(props: {
  readonly t: Translate
  readonly connectorId: string
  readonly connectionId: string
  readonly policy: SenderPolicy
  readonly senders: SendersFeed
}) {
  const { t, policy } = props
  const format = localeFormat(t)
  const save = useSave(t)
  const [read, setRead] = useState<SenderRecipientsView | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const open = (read?.recipients ?? []).filter(
    (recipient) => senderRuleFor(policy.rules, recipient.address) === undefined,
  )
  const load = async () => {
    const result = await save.run(() =>
      props.senders.recipients(props.connectorId, props.connectionId),
    )
    if (result !== undefined) {
      setRead(result)
      setPicked(new Set())
    }
  }
  const toggle = (address: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(address)
    else next.delete(address)
    setPicked(next)
  }
  const allow = async () => {
    const chosen = open.filter((recipient) => picked.has(recipient.address))
    if (chosen.length === 0) return
    const saved = await save.run(() =>
      props.senders.putRules(
        props.connectionId,
        chosen.map((recipient) => ({
          match: { kind: "address" as const, value: recipient.address },
          verdict: "allow" as const,
        })),
      ),
    )
    if (saved !== undefined) setPicked(new Set())
  }
  const count = open.filter((recipient) => picked.has(recipient.address)).length
  return (
    <Group title={t("senders.recipients")} marks={{ "data-dshb-sender-recipients": "" }}>
      <Row
        label={t("senders.recipients.description", { count: MAX_SENDER_RECIPIENT_SCAN })}
        density="compact"
        trailing={
          <Button
            variant="row"
            disabled={save.busy}
            onClick={() => void load()}
            marks={{ "data-dshb-sender-recipients-load": "" }}
          >
            {save.busy && read === undefined
              ? t("senders.recipients.loading")
              : t("senders.recipients.load")}
          </Button>
        }
      />
      {save.error !== null && <Row label={save.error} metaTone="danger" density="compact" />}
      {read !== undefined && (
        <>
          <Row label={t("senders.recipients.scanned", { count: read.scanned })} density="compact" />
          {open.length === 0 && <Row label={t("senders.recipients.none")} density="compact" />}
          {open.map((recipient) => (
            <Row
              key={recipient.address}
              label={
                recipient.name === undefined
                  ? recipient.address
                  : `${recipient.name} <${recipient.address}>`
              }
              meta={format.count("senders.recipients.messages", recipient.messages)}
              density="compact"
              marks={{ "data-dshb-sender-recipient": recipient.address }}
              trailing={
                <Switch
                  checked={picked.has(recipient.address)}
                  label={t("senders.recipients.pick", { address: recipient.address })}
                  onChange={(on) => toggle(recipient.address, on)}
                />
              }
            />
          ))}
          {open.length > 0 && (
            <Row
              label=""
              density="compact"
              trailing={
                <Button
                  variant="primary"
                  disabled={save.busy || count === 0}
                  onClick={() => void allow()}
                  marks={{ "data-dshb-sender-recipients-allow": "" }}
                >
                  {t("senders.recipients.allow", { count })}
                </Button>
              }
            />
          )}
        </>
      )}
    </Group>
  )
}

function CopyGroup(props: {
  readonly t: Translate
  readonly account: SenderPolicyView
  readonly policy: SenderPolicy
  readonly others: readonly SenderPolicyView[]
  readonly senders: SendersFeed
  readonly confirm: SettingsSectionProps["confirm"]
}) {
  const { t, others } = props
  const format = localeFormat(t)
  const save = useSave(t)
  const [target, setTarget] = useState<string | undefined>(others[0]?.connectionId)
  const [done, setDone] = useState<string | undefined>(undefined)
  const chosen = others.find((item) => item.connectionId === target) ?? others[0]
  const copy = async () => {
    if (chosen === undefined) return
    const confirmed = await props.confirm({
      title: t("senders.copy.confirm.title", { account: chosen.account }),
      description: t("senders.copy.confirm.description", {
        account: chosen.account,
        rules: format.count("senders.ruleCount", props.policy.rules.length),
      }),
      confirm: t("senders.copy.confirm.accept"),
      tone: "danger",
    })
    if (!confirmed) return
    const saved = await save.run(() =>
      props.senders.copy(props.account.connectionId, chosen.connectionId),
    )
    if (saved !== undefined) setDone(chosen.account)
  }
  return (
    <Group title={t("senders.copy")} marks={{ "data-dshb-sender-copy": "" }}>
      {others.length === 0 ? (
        <Row label={t("senders.copy.none")} density="compact" />
      ) : (
        <>
          <Row label={t("senders.copy.description")} density="compact" />
          <BlockRow label={t("senders.copy.target")}>
            <div className="dshb-tools-exception-draft">
              <Select
                value={chosen?.connectionId ?? ""}
                choices={others.map((item) => ({ value: item.connectionId, label: item.account }))}
                label={t("senders.copy.target")}
                disabled={save.busy}
                onChange={(value) => {
                  setTarget(value)
                  setDone(undefined)
                }}
                marks={{ "data-dshb-sender-copy-target": "" }}
              />
              <Button
                variant="secondary"
                disabled={save.busy}
                onClick={() => void copy()}
                marks={{ "data-dshb-sender-copy-submit": "" }}
              >
                {t("senders.copy.submit")}
              </Button>
            </div>
          </BlockRow>
          {save.error !== null && <Row label={save.error} metaTone="danger" density="compact" />}
          {done !== undefined && (
            <Row label={t("senders.copy.done", { account: done })} density="compact" />
          )}
        </>
      )}
    </Group>
  )
}
