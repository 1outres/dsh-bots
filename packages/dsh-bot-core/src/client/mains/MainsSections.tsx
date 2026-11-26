import type { ReactNode } from "react"
import type { BotMainsView, MainRotationSettings } from "../../shared/mains"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { useObservable } from "../hooks"
import { IconRefresh } from "../icons"
import { localeFormat } from "../locale-format"
import type { SettingsSectionProps } from "../settings/sections"
import type { Translate } from "../types"
import {
  Button,
  type CommitResult,
  commitWith,
  ErrorText,
  Group,
  Row,
  StatusPill,
  Switch,
  Tag,
  TextField,
  useTextDraft,
} from "../ui"
import type { FeedState, MainsClient } from "./client"
import {
  type FieldsOf,
  fieldValues,
  MAIN_FIELDS,
  type MainField,
  type MainFieldId,
  type MainFieldValues,
  overriddenFields,
  overrideOf,
  parseBoundedInteger,
  settingsOf,
} from "./model"

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const SWITCH_OF: { readonly [Id in MainFieldId]?: FieldsOf<boolean> } = {
  "idleCompaction.minUsagePercent": "idleCompaction.enabled",
  "daily.time": "daily.enabled",
  "longIdle.minutes": "longIdle.enabled",
  "compactions.count": "compactions.enabled",
}

const GROUPS: readonly {
  readonly title?: "mains.group.compaction" | "mains.group.rotation" | "mains.group.memory"
  readonly fields: readonly MainFieldId[]
}[] = [
  { fields: ["quietMinutes"] },
  {
    title: "mains.group.compaction",
    fields: ["idleCompaction.enabled", "idleCompaction.minUsagePercent"],
  },
  {
    title: "mains.group.rotation",
    fields: [
      "daily.enabled",
      "daily.time",
      "longIdle.enabled",
      "longIdle.minutes",
      "compactions.enabled",
      "compactions.count",
    ],
  },
  { title: "mains.group.memory", fields: ["memoryFlush.enabled"] },
]

const fieldOf = (id: MainFieldId): MainField => {
  const field = MAIN_FIELDS.find((candidate) => candidate.id === id)
  if (field === undefined) throw new Error(`unknown Main field "${id}"`)
  return field
}

function shown(t: Translate, field: MainField, values: MainFieldValues): string {
  const value = values[field.id]
  if (typeof value === "boolean") return t(value ? "mains.on" : "mains.off")
  return String(value)
}

function problem(t: Translate, field: MainField, text: string): string | null {
  if (field.kind === "number") {
    return parseBoundedInteger(text, field.bounds) === undefined
      ? t("mains.invalidNumber", { min: field.bounds.min, max: field.bounds.max })
      : null
  }
  if (field.kind === "time") return TIME.test(text.trim()) ? null : t("mains.invalidTime")
  return null
}

function parsed(field: MainField, text: string): number | string {
  return field.kind === "number" ? Number(text.trim()) : text.trim()
}

interface FieldRowProps {
  readonly t: Translate
  readonly field: MainField
  readonly values: MainFieldValues
  save(field: MainField, value: MainFieldValues[MainFieldId]): Promise<CommitResult>
  readonly inherit?: {
    readonly defaults: MainFieldValues
    readonly own: boolean
    reset(field: MainField): Promise<CommitResult>
  }
}

function useFieldDraft(props: FieldRowProps) {
  const { t, field, values, save } = props
  return useTextDraft({
    value: shown(t, field, values),
    validate: (text) => problem(t, field, text),
    commit: (text) => save(field, parsed(field, text)),
  })
}

function FieldRow(props: FieldRowProps) {
  const { t, field, values, inherit } = props
  const draft = useFieldDraft(props)
  const label = t(field.label)
  const switchId = SWITCH_OF[field.id]
  const off = switchId !== undefined && values[switchId] === false
  const own = inherit?.own === true
  const meta =
    draft.error ??
    (own && inherit !== undefined
      ? t("mains.defaultValue", { value: shown(t, field, inherit.defaults) })
      : undefined)
  const extra: ReactNode =
    own && inherit !== undefined ? (
      <>
        <Tag marks={{ "data-dshb-mains-own": field.id }}>{t("mains.custom")}</Tag>
        <Button
          variant="icon"
          label={t("mains.useDefault", { value: shown(t, field, inherit.defaults) })}
          onClick={() => void inherit.reset(field)}
          marks={{ "data-dshb-mains-reset": field.id }}
        >
          <IconRefresh size={14} />
        </Button>
      </>
    ) : null
  const control =
    field.kind === "switch" ? (
      <Switch
        checked={values[field.id]}
        label={label}
        onChange={(checked) => void props.save(field, checked)}
        marks={{ "data-dshb-mains-field": field.id }}
      />
    ) : (
      <TextField
        draft={draft}
        label={label}
        disabled={off}
        type="text"
        marks={{ "data-dshb-mains-field": field.id }}
      />
    )
  return (
    <Row
      label={label}
      meta={meta}
      metaTone={draft.error === null ? undefined : "danger"}
      trailing={
        <>
          {extra}
          {control}
        </>
      }
    />
  )
}

function Fields(
  props: Omit<FieldRowProps, "field" | "inherit"> & {
    readonly inherit?: {
      readonly defaults: MainFieldValues
      readonly own: ReadonlySet<MainFieldId>
      reset(field: MainField): Promise<CommitResult>
    }
  },
) {
  const { t, inherit } = props
  return (
    <>
      {GROUPS.map((group) => (
        <Group key={group.fields[0]} title={group.title === undefined ? undefined : t(group.title)}>
          {group.fields.map((id) => (
            <FieldRow
              key={id}
              {...props}
              field={fieldOf(id)}
              inherit={
                inherit === undefined
                  ? undefined
                  : { defaults: inherit.defaults, own: inherit.own.has(id), reset: inherit.reset }
              }
            />
          ))}
        </Group>
      ))}
    </>
  )
}

function failed<T>(state: FeedState<T>): state is Extract<FeedState<T>, { status: "failed" }> {
  return state.status === "failed"
}

export function GlobalMainsSection(
  props: GlobalSettingsSectionProps & {
    readonly mains: Pick<MainsClient, "defaults" | "setDefaults">
  },
) {
  const { t, mains } = props
  const state = useObservable(mains.defaults)
  if (failed(state)) return <ErrorText>{t("error.generic", { message: state.message })}</ErrorText>
  if (state.status === "loading") return <Row label={t("mains.loading")} />
  const current: MainRotationSettings = state.value
  const save = (field: MainField, value: MainFieldValues[MainFieldId]) =>
    commitWith(
      () => mains.setDefaults(settingsOf({ ...fieldValues(current), [field.id]: value })),
      (cause) => t("error.generic", { message: messageOf(cause) }),
    )
  return (
    <div className="dshb-settings-groups" data-dshb-mains="defaults">
      <Fields t={t} values={fieldValues(current)} save={save} />
    </div>
  )
}

export interface BotMainsSectionDeps {
  readonly mains: Pick<MainsClient, "bot" | "configure">
  startNewMain(botId: string): void
}

export function BotMainsSection(props: SettingsSectionProps & BotMainsSectionDeps) {
  const { t, bot, mains } = props
  const state = useObservable(mains.bot(bot.id))
  if (failed(state)) return <ErrorText>{t("error.generic", { message: state.message })}</ErrorText>
  if (state.status === "loading") return <Row label={t("mains.loading")} />
  const view: BotMainsView = state.value
  const effective = fieldValues(view.effective)
  const own = overriddenFields(view.override)
  const store = (values: MainFieldValues, fields: ReadonlySet<MainFieldId>) =>
    commitWith(
      () => mains.configure(bot.id, overrideOf(values, fields)),
      (cause) => t("error.generic", { message: messageOf(cause) }),
    )
  const save = (field: MainField, value: MainFieldValues[MainFieldId]) =>
    store({ ...effective, [field.id]: value }, new Set([...own, field.id]))
  const reset = (field: MainField) =>
    store(effective, new Set([...own].filter((id) => id !== field.id)))
  const { status } = view
  const format = localeFormat(t)
  return (
    <div className="dshb-settings-groups" data-dshb-mains="bot">
      <Group>
        <Row
          label={t("mains.current")}
          meta={t("mains.currentMeta", {
            since: format.instant(status.startedAt, "dateTime"),
            compactions: status.compactions,
          })}
          trailing={
            <>
              {status.maintenance !== "idle" && (
                <StatusPill
                  tone="busy"
                  label={t(
                    status.maintenance === "rotating" ? "mains.rotating" : "mains.compacting",
                  )}
                />
              )}
              <Button
                variant="row"
                disabled={status.maintenance !== "idle"}
                onClick={() => props.startNewMain(bot.id)}
                marks={{ "data-dshb-mains-new": "" }}
              >
                {t("mains.startNew")}
              </Button>
            </>
          }
        />
      </Group>
      <Fields
        t={t}
        values={effective}
        save={save}
        inherit={{ defaults: fieldValues(view.defaults), own, reset }}
      />
    </div>
  )
}
