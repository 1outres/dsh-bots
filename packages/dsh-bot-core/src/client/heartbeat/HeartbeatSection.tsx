import type { BotHeartbeatView, HeartbeatSettings, HeartbeatStatus } from "../../shared/heartbeat"
import { MAX_HEARTBEAT_MINUTES, MIN_HEARTBEAT_MINUTES } from "../../shared/heartbeat"
import { useObservable } from "../hooks"
import { localeFormat } from "../locale-format"
import type { SettingsSectionProps } from "../settings/sections"
import type { Translate } from "../types"
import { commitWith, ErrorText, Group, Row, Switch, TextField, useTextDraft } from "../ui"
import type { HeartbeatClient } from "./client"

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const DEFAULT_HOURS = { start: "09:00", end: "18:00" } as const

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

interface FieldProps {
  readonly t: Translate
  readonly label: string
  readonly value: string
  readonly disabled?: boolean
  readonly field: string
  validate(text: string): string | null
  save(text: string): ReturnType<typeof commitWith>
}

function Field(props: FieldProps) {
  const draft = useTextDraft({
    value: props.value,
    validate: props.validate,
    commit: (text) => props.save(text.trim()),
  })
  return (
    <Row
      label={props.label}
      meta={draft.error ?? undefined}
      metaTone={draft.error === null ? undefined : "danger"}
      trailing={
        <TextField
          draft={draft}
          label={props.label}
          disabled={props.disabled}
          type="text"
          marks={{ "data-dshb-heartbeat-field": props.field }}
        />
      }
    />
  )
}

function statusText(t: Translate, status: HeartbeatStatus): string {
  const format = localeFormat(t)
  const next =
    status.next === undefined
      ? t("heartbeat.noNext")
      : t("heartbeat.next", { at: format.instant(status.next, "dateTime") })
  if (status.last === undefined) return next
  const last = t(`heartbeat.last.${status.last.outcome}`, {
    at: format.instant(status.last.at, "dateTime"),
  })
  return `${next} · ${last}`
}

export function HeartbeatSection(
  props: SettingsSectionProps & { readonly heartbeat: HeartbeatClient },
) {
  const { t, bot, heartbeat } = props
  const state = useObservable(heartbeat.bot(bot.id))
  if (state.status === "failed") {
    return <ErrorText>{t("error.generic", { message: state.message })}</ErrorText>
  }
  if (state.status === "loading") return <Row label={t("heartbeat.loading")} />
  const view: BotHeartbeatView = state.value
  const { settings } = view
  const save = (next: HeartbeatSettings) =>
    commitWith(
      () => heartbeat.configure(bot.id, next),
      (cause) => t("error.generic", { message: messageOf(cause) }),
    )
  const hours = settings.activeHours
  const withHours = (change: Partial<{ start: string; end: string }>) =>
    save({ ...settings, activeHours: { ...(hours ?? DEFAULT_HOURS), ...change } })
  const timeProblem = (text: string) => (TIME.test(text.trim()) ? null : t("heartbeat.invalidTime"))
  return (
    <div className="dshb-settings-groups" data-dshb-heartbeat="bot">
      <Group>
        <Row
          label={t("heartbeat.enabled")}
          meta={t("heartbeat.enabledMeta")}
          trailing={
            <Switch
              checked={settings.enabled}
              label={t("heartbeat.enabled")}
              onChange={(enabled) => void save({ ...settings, enabled })}
              marks={{ "data-dshb-heartbeat-field": "enabled" }}
            />
          }
        />
        <Field
          t={t}
          label={t("heartbeat.interval")}
          field="intervalMinutes"
          value={String(settings.intervalMinutes)}
          disabled={!settings.enabled}
          validate={(text) => {
            const value = Number(text.trim())
            return /^\d+$/.test(text.trim()) &&
              value >= MIN_HEARTBEAT_MINUTES &&
              value <= MAX_HEARTBEAT_MINUTES
              ? null
              : t("heartbeat.invalidNumber", {
                  min: MIN_HEARTBEAT_MINUTES,
                  max: MAX_HEARTBEAT_MINUTES,
                })
          }}
          save={(text) => save({ ...settings, intervalMinutes: Number(text) })}
        />
        <Row label={t("heartbeat.status")} meta={statusText(t, view.status)} />
      </Group>
      <Group title={t("heartbeat.group.hours")}>
        <Row
          label={t("heartbeat.hours")}
          trailing={
            <Switch
              checked={hours !== undefined}
              label={t("heartbeat.hours")}
              disabled={!settings.enabled}
              onChange={(on) => {
                const { activeHours: _hours, ...rest } = settings
                void save(on ? { ...rest, activeHours: DEFAULT_HOURS } : rest)
              }}
              marks={{ "data-dshb-heartbeat-field": "activeHours" }}
            />
          }
        />
        {hours !== undefined && (
          <>
            <Field
              t={t}
              label={t("heartbeat.start")}
              field="activeHours.start"
              value={hours.start}
              disabled={!settings.enabled}
              validate={timeProblem}
              save={(start) => withHours({ start })}
            />
            <Field
              t={t}
              label={t("heartbeat.end")}
              field="activeHours.end"
              value={hours.end}
              disabled={!settings.enabled}
              validate={timeProblem}
              save={(end) => withHours({ end })}
            />
          </>
        )}
      </Group>
    </div>
  )
}
