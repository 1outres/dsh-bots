import { useMemo, useRef } from "react"
import type {
  BotChannelChange,
  BotChannelChoice,
  BotChannelField,
  BotChannelInspection,
  BotChannelListField,
  BotChannelOption,
  BotChannelOptions,
  BotChannelPickField,
  BotChannelText,
  BotChannelTextField,
  BotChannelView,
} from "../../shared/channels"
import {
  type ChannelEdit,
  type ChannelFieldIssue,
  type ChannelHeadline,
  changeWith,
  channelHeadline,
  listIssue,
  listItemsOf,
  listTextOf,
  missingFields,
  ownersEmpty,
  textIssue,
  textOf,
} from "../channel-form"
import type { ChannelAsk } from "../channel-queries"
import type { ChannelsHub } from "../channels-hub"
import { ChannelsError } from "../channels-model"
import { useObservable } from "../hooks"
import type { MessageKey } from "../i18n"
import { IconChannels } from "../icons"
import { createSerialSaves } from "../serial-saves"
import type { Translate } from "../types"
import {
  BlockRow,
  Button,
  type CommitResult,
  commitWith,
  EmptyState,
  ErrorText,
  Group,
  LinkRow,
  OptionPicker,
  type PickerOption,
  type QueryState,
  Row,
  SecretRow,
  Select,
  StatusPill,
  Switch,
  TextArea,
  TextField,
  useQuery,
  useTextDraft,
} from "../ui"
import { failureText } from "./failure-text"
import type { SettingsSectionProps } from "./sections"

export interface ChannelsSectionDeps {
  readonly channels: ChannelsHub
  text(text: BotChannelText): string
}

export function ChannelsSection({
  t,
  bot,
  channels,
  text,
}: SettingsSectionProps & ChannelsSectionDeps) {
  const feed = channels.feed(bot.id)
  const state = useObservable(feed)
  if (state.status === "loading")
    return (
      <Group>
        <Row label={t("channels.loading")} />
      </Group>
    )
  if (state.status === "failed") {
    return <ErrorText>{t("channels.unavailable", { message: state.failure.message })}</ErrorText>
  }
  if (state.snapshot.channels.length === 0) {
    return <EmptyState icon={<IconChannels size={28} />} title={t("channels.none")} />
  }
  return (
    <div className="dshb-settings-groups" data-dshb-channels="">
      {state.snapshot.channels.map((view) => (
        <ChannelGroup
          key={view.channel.id}
          t={t}
          text={text}
          view={view}
          configure={feed.configure}
          ask={channels.ask(bot.id, view.channel.id)}
        />
      ))}
    </div>
  )
}

const HEADLINE_LABEL: Readonly<Record<ChannelHeadline["state"], MessageKey>> = {
  off: "channels.status.off",
  failed: "channels.status.failed",
  incomplete: "channels.status.incomplete",
  noOwners: "channels.status.noOwners",
  waiting: "channels.status.waiting",
  connecting: "channels.status.connecting",
  connected: "channels.status.connected",
}

const ISSUE_TEXT = (t: Translate, issue: ChannelFieldIssue): string => {
  switch (issue.kind) {
    case "length":
      return t("channels.issue.length", { max: issue.max })
    case "format":
      return t("channels.issue.format")
    case "count":
      return t("channels.issue.count", { max: issue.max })
    case "item":
      return t("channels.issue.item", { item: issue.item })
  }
}

export type ChannelConfigure = (
  channelId: string,
  change: BotChannelChange,
) => Promise<BotChannelView>

export interface ChannelGroupProps {
  readonly t: Translate
  text(text: BotChannelText): string
  readonly view: BotChannelView
  readonly configure: ChannelConfigure
  readonly ask: ChannelAsk
}

const settingsKey = (view: BotChannelView) =>
  JSON.stringify([view.revision, view.values, view.secrets])

export function ChannelGroup({ t, text, view, configure, ask }: ChannelGroupProps) {
  const { channel } = view
  const latest = useRef(view)
  latest.current = view
  const saves = useMemo(
    () =>
      createSerialSaves<BotChannelView, ChannelEdit>({
        current: () => latest.current,
        apply: (stored, edit) => configure(channel.id, changeWith(stored, edit)),
      }),
    [configure, channel.id],
  )
  const save = (edit: ChannelEdit): Promise<CommitResult> =>
    commitWith(
      () => saves.save(edit),
      (cause) =>
        cause instanceof ChannelsError && cause.failure.kind === "check"
          ? text(cause.failure.reason)
          : failureText(t, cause),
    )
  const key = settingsKey(view)
  const inspection = useQuery(key, (signal) => ask.inspect(signal))
  const headline = channelHeadline(view)
  const missing = missingFields(view)
  const id = channel.id
  return (
    <Group marks={{ "data-dshb-channel": id }}>
      <Row
        label={<span className="dshb-channel-name">{channel.name}</span>}
        meta={headline.meta}
        metaTone={headline.state === "failed" ? "danger" : undefined}
        description={channel.description === undefined ? undefined : text(channel.description)}
        trailing={
          <>
            <StatusPill
              tone={headline.tone}
              label={t(HEADLINE_LABEL[headline.state])}
              marks={{ "data-dshb-channel-state": headline.state }}
            />
            <Switch
              checked={view.enabled}
              label={t("channels.enabled", { channel: channel.name })}
              onChange={(enabled) => void save({ kind: "enabled", enabled })}
              marks={{ "data-dshb-channel-enabled": "" }}
            />
          </>
        }
      />
      <InspectionRows t={t} text={text} inspection={inspection} />
      {channel.fields.map((field) => (
        <ChannelField
          key={field.key}
          t={t}
          text={text}
          view={view}
          field={field}
          missing={missing.has(field.key)}
          save={save}
          ask={ask}
          settingsKey={key}
        />
      ))}
      {channel.guide !== undefined && (
        <LinkRow
          label={t("channels.guide")}
          href={channel.guide}
          marks={{ "data-dshb-channel-guide": "" }}
        />
      )}
    </Group>
  )
}

interface FieldProps {
  readonly t: Translate
  text(text: BotChannelText): string
  readonly view: BotChannelView
  readonly field: BotChannelField
  readonly missing: boolean
  save(edit: ChannelEdit): Promise<CommitResult>
  readonly ask: ChannelAsk
  readonly settingsKey: string
}

function ChannelField(props: FieldProps) {
  const { t, text, view, field, missing, save } = props
  const label = text(field.label)
  const description = field.description === undefined ? undefined : text(field.description)
  const marks = { "data-dshb-channel-field": field.key }
  switch (field.kind) {
    case "secret":
      return (
        <SecretRow
          t={t}
          label={label}
          saved={view.secrets[field.key] === true}
          commit={(secret) => save({ kind: "secret", key: field.key, secret })}
          remove={() => save({ kind: "secret", key: field.key, secret: null })}
          status={missing ? <StatusPill tone="warning" label={t("channels.missing")} /> : undefined}
          marks={marks}
        />
      )
    case "text":
      return field.choices === undefined ? (
        <TextRow
          t={t}
          label={label}
          description={description}
          view={view}
          field={field}
          missing={missing}
          save={save}
        />
      ) : (
        <ChoiceField
          text={text}
          label={label}
          description={description}
          view={view}
          field={field}
          choices={field.choices}
          save={save}
        />
      )
    case "pick":
      return <PickField {...props} field={field} label={label} description={description} />
    case "list":
      return field.item.source !== undefined ? (
        <PickListField
          {...props}
          field={field}
          source={field.item.source}
          label={label}
          description={description}
        />
      ) : (
        <ListField
          t={t}
          label={label}
          description={description}
          view={view}
          field={field}
          missing={missing}
          save={save}
        />
      )
  }
}

const issueText = (t: Translate, issue: ChannelFieldIssue | null) =>
  issue === null ? null : ISSUE_TEXT(t, issue)

function TextRow(props: {
  readonly t: Translate
  readonly label: string
  readonly description: string | undefined
  readonly view: BotChannelView
  readonly field: BotChannelTextField
  readonly missing: boolean
  save(edit: ChannelEdit): Promise<CommitResult>
}) {
  const { t, label, view, field, missing, save } = props
  const draft = useTextDraft({
    value: textOf(view, field.key),
    validate: (typed) => issueText(t, textIssue(field, typed)),
    commit: (typed) => save({ kind: "value", key: field.key, value: typed.trim() }),
  })
  const meta = draft.error ?? (missing ? t("channels.missing") : undefined)
  return (
    <Row
      label={label}
      description={props.description}
      meta={meta}
      metaTone={meta === undefined ? undefined : "danger"}
      trailing={
        <TextField
          draft={draft}
          label={label}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          marks={{ "data-dshb-channel-field": field.key }}
        />
      }
    />
  )
}

function ChoiceField(props: {
  text(text: BotChannelText): string
  readonly label: string
  readonly description: string | undefined
  readonly view: BotChannelView
  readonly field: BotChannelTextField
  readonly choices: readonly BotChannelChoice[]
  save(edit: ChannelEdit): Promise<CommitResult>
}) {
  const { text, label, view, field, save } = props
  const choices = props.choices.map((choice) => ({
    value: choice.value,
    label: text(choice.label),
  }))
  return (
    <Row
      label={label}
      description={props.description}
      trailing={
        <Select
          value={textOf(view, field.key)}
          choices={choices}
          label={label}
          onChange={(value) => void save({ kind: "value", key: field.key, value })}
          marks={{ "data-dshb-channel-field": field.key }}
        />
      }
    />
  )
}

function ListField(props: {
  readonly t: Translate
  readonly label: string
  readonly description: string | undefined
  readonly view: BotChannelView
  readonly field: BotChannelListField
  readonly missing: boolean
  save(edit: ChannelEdit): Promise<CommitResult>
}) {
  const { t, label, view, field, missing, save } = props
  const draft = useTextDraft({
    value: listTextOf(view, field.key),
    validate: (typed) => issueText(t, listIssue(field, typed)),
    commit: (typed) =>
      save({ kind: "value", key: field.key, value: [...new Set(listItemsOf(typed))] }),
  })
  const noOwners = view.enabled && view.channel.owners === field.key && ownersEmpty(view)
  const meta =
    draft.error ??
    (missing ? t("channels.missing") : noOwners ? t("channels.owners.none") : undefined)
  return (
    <BlockRow
      label={label}
      description={props.description}
      meta={meta}
      metaTone={draft.error !== null || missing ? "danger" : noOwners ? "warning" : undefined}
      marks={{ "data-dshb-channel-list": field.key }}
    >
      <TextArea
        draft={draft}
        label={label}
        placeholder={field.item.placeholder}
        flag={missing ? "danger" : noOwners ? "warning" : undefined}
        marks={{ "data-dshb-channel-field": field.key }}
      />
    </BlockRow>
  )
}

function InspectionRows(props: {
  readonly t: Translate
  text(text: BotChannelText): string
  readonly inspection: QueryState<BotChannelInspection>
}) {
  const { t, text, inspection } = props
  if (inspection.status === "loading") return null
  if (inspection.status === "failed") {
    return (
      <Row
        label={t("channels.inspect.failed")}
        meta={inspection.message}
        metaTone="danger"
        marks={{ "data-dshb-channel-inspection": "failed" }}
      />
    )
  }
  const { value } = inspection
  if (value.state === "unavailable") return null
  return (
    <>
      {value.account !== undefined && (
        <Row
          label={t("channels.inspect.account")}
          meta={value.account}
          marks={{ "data-dshb-channel-account": "" }}
        />
      )}
      {value.warnings.map((warning) => (
        <Row
          key={warning.en}
          label={text(warning)}
          trailing={<StatusPill tone="warning" label={t("channels.inspect.warning")} />}
          marks={{ "data-dshb-channel-warning": "" }}
        />
      ))}
      {value.links.map((link) => (
        <LinkRow
          key={link.url}
          label={text(link.label)}
          href={link.url}
          marks={{ "data-dshb-channel-link": "" }}
        />
      ))}
    </>
  )
}

const pickerOption = (
  text: (text: BotChannelText) => string,
  option: BotChannelOption,
): PickerOption => ({
  value: option.value,
  label: text(option.label),
  ...(option.detail === undefined ? {} : { detail: text(option.detail) }),
  ...(option.image === undefined ? {} : { image: option.image }),
})

function useOptions(
  props: FieldProps,
  source: string,
): {
  readonly options: QueryState<BotChannelOptions>
  readonly listed: readonly PickerOption[]
} {
  const options = useQuery(`${source}|${props.settingsKey}`, (signal) =>
    props.ask.options(source, signal),
  )
  const listed =
    options.status === "ready" && options.value.state === "ready"
      ? options.value.options.map((option) => pickerOption(props.text, option))
      : []
  return { options, listed }
}

function pickMeta(
  props: FieldProps,
  options: QueryState<BotChannelOptions>,
  empty: boolean,
): { readonly meta: string | undefined; readonly tone: "danger" | "warning" | undefined } {
  const { t, text } = props
  if (options.status === "failed") {
    return { meta: t("channels.options.failed", { message: options.message }), tone: "danger" }
  }
  if (options.status === "ready" && options.value.state === "unavailable") {
    return { meta: text(options.value.reason), tone: "warning" }
  }
  if (props.missing) return { meta: t("channels.missing"), tone: "danger" }
  if (empty && options.status === "loading")
    return { meta: t("channels.options.loading"), tone: undefined }
  return { meta: undefined, tone: undefined }
}

function suggestionOf(options: QueryState<BotChannelOptions>, empty: boolean): readonly string[] {
  if (!empty || options.status !== "ready" || options.value.state !== "ready") return []
  return options.value.suggested
}

function SuggestionRow(props: {
  readonly t: Translate
  readonly suggested: readonly string[]
  readonly listed: readonly PickerOption[]
  readonly field: string
  use(values: readonly string[]): void
}) {
  const { t, suggested, listed } = props
  if (suggested.length === 0) return null
  const names = suggested
    .map((value) => listed.find((option) => option.value === value)?.label ?? value)
    .join(", ")
  return (
    <Row
      label={t("channels.suggested", { value: names })}
      density="compact"
      trailing={
        <Button
          variant="secondary"
          onClick={() => props.use(suggested)}
          marks={{ "data-dshb-channel-suggestion": props.field }}
        >
          {t("channels.suggested.use")}
        </Button>
      }
    />
  )
}

const unknownOption = (t: Translate) => (value: string) => ({
  value,
  label: t("channels.options.unknown"),
  detail: value,
})

function PickField(
  props: FieldProps & {
    readonly field: BotChannelPickField
    readonly label: string
    readonly description: string | undefined
  },
) {
  const { t, view, field, label, save } = props
  const stored = textOf(view, field.key)
  const { options, listed } = useOptions(props, field.source)
  const { meta, tone } = pickMeta(props, options, stored === "")
  const pick = (values: readonly string[]) =>
    void save({ kind: "value", key: field.key, value: values[0] ?? "" })
  return (
    <>
      <Row
        label={label}
        description={props.description}
        meta={meta}
        metaTone={tone}
        marks={{ "data-dshb-channel-pick": field.key }}
        trailing={
          <OptionPicker
            t={t}
            options={listed}
            selected={stored === "" ? [] : [stored]}
            multiple={false}
            onChange={pick}
            unknown={unknownOption(t)}
            placeholder={t("channels.options.choose")}
            label={label}
            marks={{ "data-dshb-channel-field": field.key }}
          />
        }
      />
      <SuggestionRow
        t={t}
        suggested={suggestionOf(options, stored === "")}
        listed={listed}
        field={field.key}
        use={pick}
      />
    </>
  )
}

function PickListField(
  props: FieldProps & {
    readonly field: BotChannelListField
    readonly source: string
    readonly label: string
    readonly description: string | undefined
  },
) {
  const { t, view, field, label, save } = props
  const stored = view.values[field.key]
  const selected: readonly string[] = Array.isArray(stored) ? stored : []
  const { options, listed } = useOptions(props, props.source)
  const picked = pickMeta(props, options, selected.length === 0)
  const noOwners =
    picked.meta === undefined &&
    view.enabled &&
    view.channel.owners === field.key &&
    ownersEmpty(view)
  const pick = (values: readonly string[]) =>
    void save({ kind: "value", key: field.key, value: values })
  return (
    <>
      <Row
        label={label}
        description={props.description}
        meta={noOwners ? t("channels.owners.none") : picked.meta}
        metaTone={noOwners ? "warning" : picked.tone}
        marks={{ "data-dshb-channel-list": field.key }}
        trailing={
          <OptionPicker
            t={t}
            options={listed}
            selected={selected}
            multiple
            max={field.maxItems}
            onChange={pick}
            unknown={unknownOption(t)}
            placeholder={t("channels.options.choose")}
            label={label}
            marks={{ "data-dshb-channel-field": field.key }}
          />
        }
      />
      <SuggestionRow
        t={t}
        suggested={suggestionOf(options, selected.length === 0)}
        listed={listed}
        field={field.key}
        use={pick}
      />
    </>
  )
}
