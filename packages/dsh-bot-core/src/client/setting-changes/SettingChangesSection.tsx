import { useState } from "react"
import type { BotChannelText } from "../../shared/channels"
import type {
  BotSettingApprover,
  BotSettingHistoryRow,
  BotSettingRevertState,
} from "../../shared/settings"
import { useObservable } from "../hooks"
import { IconRefresh } from "../icons"
import { localeFormat } from "../locale-format"
import type { SettingsSectionProps } from "../settings/sections"
import type { Translate } from "../types"
import { BlockRow, Button, EmptyState, ErrorText, Group, Row, Tag } from "../ui"
import type { SettingChangesClient } from "./client"

export interface SettingChangesSectionDeps {
  readonly changes: SettingChangesClient
  text(value: BotChannelText): string
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

function approverOf(t: Translate, approver: BotSettingApprover | undefined): string | undefined {
  if (approver === undefined) return undefined
  return approver.kind === "web"
    ? t("settingChanges.approvedInWeb")
    : t("settingChanges.approvedIn", { channel: approver.channelName })
}

function stateTag(
  t: Translate,
  text: SettingChangesSectionDeps["text"],
  revert: BotSettingRevertState,
) {
  switch (revert.state) {
    case "available":
      return undefined
    case "checking":
      return <Tag>{t("settingChanges.checking")}</Tag>
    case "reverted":
      return (
        <Tag>
          {t("settingChanges.reverted", {
            at: localeFormat(t).instant(revert.at, "dateTime"),
          })}
        </Tag>
      )
    case "superseded":
      return <Tag>{t("settingChanges.superseded")}</Tag>
    case "unavailable":
      return <Tag>{text(revert.reason)}</Tag>
  }
}

function ChangeRow(
  props: SettingChangesSectionDeps & {
    readonly t: Translate
    readonly row: BotSettingHistoryRow
    readonly busy: boolean
    readonly error: string | undefined
    revert(): void
  },
) {
  const { t, text, row, busy, error } = props
  const { change, revert } = row
  const meta = [
    localeFormat(t).instant(change.at, "dateTime"),
    approverOf(t, change.approvedBy),
    change.reason,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ")
  return (
    <BlockRow
      label={text(change.areaLabel)}
      meta={error ?? meta}
      metaTone={error === undefined ? undefined : "danger"}
      trailing={
        revert.state === "available" ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={props.revert}
            marks={{ "data-dshb-setting-revert": change.id }}
          >
            {t("settingChanges.revert")}
          </Button>
        ) : (
          stateTag(t, text, revert)
        )
      }
      marks={{ "data-dshb-setting-change": change.id, "data-state": revert.state }}
    >
      <ul className="dshb-setting-change-items">
        {change.items.map((item) => (
          <li key={item.key}>
            <span className="dshb-setting-change-label">{text(item.label)}</span>
            {": "}
            {text(item.before.shown)} → {text(item.after.shown)}
          </li>
        ))}
      </ul>
    </BlockRow>
  )
}

export function SettingChangesSection(props: SettingsSectionProps & SettingChangesSectionDeps) {
  const { t, bot, changes, text } = props
  const state = useObservable(changes.bot(bot.id))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ readonly id: string; readonly message: string } | null>(null)
  if (state.status === "failed") {
    return <ErrorText>{t("settingChanges.unavailable", { message: state.message })}</ErrorText>
  }
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("settingChanges.loading")} />
      </Group>
    )
  }
  const revert = async (row: BotSettingHistoryRow) => {
    const confirmed = await props.confirm({
      title: t("settingChanges.revert.title", { area: text(row.change.areaLabel) }),
      description: t("settingChanges.revert.description"),
      confirm: t("settingChanges.revert"),
      tone: "primary",
    })
    if (!confirmed) return
    setBusy(row.change.id)
    setError(null)
    try {
      const result = await changes.revert(bot.id, row.change.id)
      if (!result.reverted) setError({ id: row.change.id, message: text(result.reason) })
    } catch (cause) {
      setError({ id: row.change.id, message: t("error.generic", { message: messageOf(cause) }) })
    } finally {
      setBusy(null)
    }
  }
  const { rows } = state.value
  return (
    <div className="dshb-settings-groups" data-dshb-setting-changes="">
      {rows.length === 0 ? (
        <EmptyState
          icon={<IconRefresh size={28} />}
          title={t("settingChanges.none")}
          detail={t("settingChanges.none.detail")}
          marks={{ "data-dshb-setting-changes-none": "" }}
        />
      ) : (
        <Group title={t("settingChanges.group")}>
          {rows.map((row) => (
            <ChangeRow
              key={row.change.id}
              t={t}
              text={text}
              changes={changes}
              row={row}
              busy={busy !== null}
              error={error?.id === row.change.id ? error.message : undefined}
              revert={() => void revert(row)}
            />
          ))}
        </Group>
      )}
    </div>
  )
}
