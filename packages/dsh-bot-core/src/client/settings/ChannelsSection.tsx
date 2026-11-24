import { useMemo, useRef } from "react"
import type {
  BotChannelChoice,
  BotChannelField,
  BotChannelListField,
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
import type { ChannelsFeed, ChannelsHub } from "../channels-hub"
import { useObservable } from "../hooks"
import type { MessageKey } from "../i18n"
import { IconChannels } from "../icons"
import { createSerialSaves } from "../serial-saves"
import type { Translate } from "../types"
import {
  BlockRow,
  type CommitResult,
  commitWith,
  EmptyState,
  ErrorText,
  Group,
  LinkRow,
  Row,
  SecretRow,
  Select,
  StatusPill,
  Switch,
  TextArea,
  TextField,
  useTextDraft,
} from "../ui"
import { failureText } from "./failure-text"
import type { SettingsSectionProps } from "./sections"

export interface ChannelsSectionDeps {
  readonly channels: ChannelsHub
  /** A channel plugin's text in the active language. */
  text(text: BotChannelText): string
}

/** The bot's channels (Discord, ...): one group per registered channel plugin, each change saved at once. */
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
        <ChannelGroup key={view.channel.id} t={t} text={text} view={view} feed={feed} />
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

interface ChannelGroupProps {
  readonly t: Translate
  text(text: BotChannelText): string
  readonly view: BotChannelView
  readonly feed: ChannelsFeed
}

function ChannelGroup({ t, text, view, feed }: ChannelGroupProps) {
  const { channel } = view
  const latest = useRef(view)
  latest.current = view
  const saves = useMemo(
    () =>
      createSerialSaves<BotChannelView, ChannelEdit>({
        current: () => latest.current,
        apply: (stored, edit) => feed.configure(channel.id, changeWith(stored, edit)),
      }),
    [feed, channel.id],
  )
  const save = (edit: ChannelEdit): Promise<CommitResult> =>
    commitWith(
      () => saves.save(edit),
      (cause) => failureText(t, cause),
    )
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
      {channel.fields.map((field) => (
        <ChannelField
          key={field.key}
          t={t}
          text={text}
          view={view}
          field={field}
          missing={missing.has(field.key)}
          save={save}
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
  /** A required field without a value while the channel is on. */
  readonly missing: boolean
  save(edit: ChannelEdit): Promise<CommitResult>
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
    case "list":
      return (
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
