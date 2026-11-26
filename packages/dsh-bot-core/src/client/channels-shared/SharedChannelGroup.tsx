import { useMemo, useRef } from "react"
import type { BotChannelSharedView, BotChannelText } from "../../shared/channels"
import { type ChannelFieldEdit, sharedChangeWith } from "../channel-form"
import type { ChannelAsk } from "../channel-queries"
import { ChannelsError } from "../channels-model"
import { createSerialSaves } from "../serial-saves"
import { ChannelFields, InspectionRows } from "../settings/ChannelsSection"
import { failureText } from "../settings/failure-text"
import type { Translate } from "../types"
import { type CommitResult, commitWith, Group, Row, StatusPill, Switch, useQuery } from "../ui"

type SharedEdit = ChannelFieldEdit | { readonly kind: "newBots"; readonly on: boolean }

export interface SharedChannelGroupProps {
  readonly t: Translate
  text(text: BotChannelText): string
  readonly view: BotChannelSharedView
  configure(
    channelId: string,
    change: ReturnType<typeof sharedChangeWith>,
  ): Promise<BotChannelSharedView>
  readonly ask: ChannelAsk
}

const settingsKey = (view: BotChannelSharedView) =>
  JSON.stringify([view.revision, view.values, view.secrets])

function newBotsMeta(
  t: Translate,
  text: (text: BotChannelText) => string,
  view: BotChannelSharedView,
): { readonly meta: string | undefined; readonly tone: "warning" | undefined } {
  if (!view.newBots) return { meta: undefined, tone: undefined }
  if (view.status.state !== "ready")
    return { meta: t("channels.shared.newBots.incomplete"), tone: "warning" }
  if (view.initial === undefined) return { meta: undefined, tone: undefined }
  return view.initial.state === "ready"
    ? {
        meta: t("channels.shared.newBots.summary", { summary: text(view.initial.summary) }),
        tone: undefined,
      }
    : { meta: text(view.initial.reason), tone: "warning" }
}

export function SharedChannelGroup({ t, text, view, configure, ask }: SharedChannelGroupProps) {
  const { channel } = view
  const latest = useRef(view)
  latest.current = view
  const saves = useMemo(
    () =>
      createSerialSaves<BotChannelSharedView, SharedEdit>({
        current: () => latest.current,
        apply: (stored, edit) => configure(channel.id, sharedChangeWith(stored, edit)),
      }),
    [configure, channel.id],
  )
  const save = (edit: SharedEdit): Promise<CommitResult> =>
    commitWith(
      () => saves.save(edit),
      (cause) =>
        cause instanceof ChannelsError && cause.failure.kind === "check"
          ? text(cause.failure.reason)
          : failureText(t, cause),
    )
  const key = settingsKey(view)
  const inspection = useQuery(key, (signal) => ask.inspect(signal))
  const missing = new Set(view.status.state === "incomplete" ? view.status.missing : [])
  const ready = view.status.state === "ready"
  const newBots = newBotsMeta(t, text, view)
  return (
    <Group marks={{ "data-dshb-shared-channel": channel.id }}>
      <Row
        label={<span className="dshb-channel-name">{channel.name}</span>}
        description={channel.description === undefined ? undefined : text(channel.description)}
        trailing={
          <StatusPill
            tone={ready ? "success" : "warning"}
            label={t(ready ? "channels.shared.ready" : "channels.status.incomplete")}
            marks={{ "data-dshb-shared-channel-state": view.status.state }}
          />
        }
      />
      <ChannelFields
        t={t}
        text={text}
        state={{ values: view.values, secrets: view.secrets, enabled: true }}
        fields={channel.fields}
        missing={missing}
        save={save}
        ask={ask}
        settingsKey={key}
      />
      {channel.initial && (
        <Row
          label={t("channels.shared.newBots")}
          description={t("channels.shared.newBots.description", { channel: channel.name })}
          meta={newBots.meta}
          metaTone={newBots.tone}
          marks={{ "data-dshb-shared-channel-new-bots": view.newBots ? "on" : "off" }}
          trailing={
            <Switch
              checked={view.newBots}
              label={t("channels.shared.newBots.toggle", { channel: channel.name })}
              onChange={(on) => void save({ kind: "newBots", on })}
              marks={{ "data-dshb-shared-channel-new-bots-switch": "" }}
            />
          }
        />
      )}
      <InspectionRows t={t} text={text} inspection={inspection} />
    </Group>
  )
}
