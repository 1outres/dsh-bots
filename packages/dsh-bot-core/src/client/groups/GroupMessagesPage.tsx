import { useEffect, useState } from "react"
import type { BotView } from "../../shared/bots"
import type { BotGroupView, BotPeerMessageView } from "../../shared/peers"
import { MarkdownView } from "../files/MarkdownView"
import { useObservable } from "../hooks"
import { IconMail } from "../icons"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { Button, EmptyState, ErrorText, Group, PageTitle, Row, StatusPill } from "../ui"
import { createGroupMessages } from "./messages"
import type { GroupsFeed } from "./model"
import {
  activityKey,
  botName,
  isLongMessage,
  type MessageThread,
  messagePill,
  messageReason,
  threadsOf,
} from "./view"

export interface GroupMessagesPageProps {
  readonly t: Translate
  readonly group: BotGroupView
  readonly bots: readonly BotView[]
  readonly groups: Pick<GroupsFeed, "messages">
}

export function GroupMessagesPage(props: GroupMessagesPageProps) {
  return <GroupMessages key={props.group.id} {...props} />
}

function GroupMessages({ t, group, bots, groups }: GroupMessagesPageProps) {
  const [model] = useState(() => createGroupMessages((before) => groups.messages(group.id, before)))
  const changed = activityKey(group)
  useEffect(() => {
    model.refresh()
    return () => model.cancel()
  }, [model, changed])
  const state = useObservable(model)
  return (
    <div className="dshb-settings-groups" data-dshb-group-messages-page={group.id}>
      <PageTitle>{t("groups.messages.title", { group: group.name })}</PageTitle>
      {state.status === "loading" && (
        <Group>
          <Row label={t("groups.messages.loading")} />
        </Group>
      )}
      {state.status === "failed" && (
        <ErrorText>{t("groups.messages.unavailable", { message: state.message })}</ErrorText>
      )}
      {state.status === "ready" && state.messages.length === 0 && (
        <EmptyState icon={<IconMail size={28} />} title={t("groups.messages.empty")} />
      )}
      {state.status === "ready" &&
        threadsOf(state.messages).map((thread) => (
          <ThreadGroup key={thread.id} t={t} thread={thread} bots={bots} />
        ))}
      {state.status === "ready" && state.failure !== undefined && (
        <ErrorText>{t("groups.messages.unavailable", { message: state.failure })}</ErrorText>
      )}
      {state.status === "ready" && state.earlier !== undefined && (
        <div className="dshb-groups-earlier">
          <Button
            variant="row"
            onClick={model.loadEarlier}
            disabled={state.reading !== "idle"}
            marks={{ "data-dshb-group-messages-earlier": "" }}
          >
            {state.reading === "earlier"
              ? t("groups.messages.loadingEarlier")
              : t("groups.messages.earlier")}
          </Button>
        </div>
      )}
    </div>
  )
}

function ThreadGroup(props: {
  readonly t: Translate
  readonly thread: MessageThread
  readonly bots: readonly BotView[]
}) {
  const { t, thread, bots } = props
  return (
    <Group marks={{ "data-dshb-group-thread": thread.id }}>
      {thread.messages.map((message) => (
        <MessageItem key={message.id} t={t} message={message} bots={bots} />
      ))}
    </Group>
  )
}

function MessageItem(props: {
  readonly t: Translate
  readonly message: BotPeerMessageView
  readonly bots: readonly BotView[]
}) {
  const { t, message, bots } = props
  const [open, setOpen] = useState(false)
  const long = isLongMessage(message.text)
  const pill = messagePill(t, message)
  const reason = messageReason(t, message)
  const time = localeFormat(t).instant(message.sentAt, "dateTime")
  return (
    <div
      className="dshb-ui-row dshb-groups-message"
      data-kind="block"
      data-density="regular"
      data-dshb-group-message={message.id}
      data-state={message.state}
    >
      <div className="dshb-ui-row-line">
        <span className="dshb-ui-row-text">
          <span className="dshb-ui-row-label">
            {t("groups.message.route", {
              from: botName(bots, message.from),
              to: botName(bots, message.to),
            })}
          </span>
          <span
            className="dshb-ui-row-meta"
            data-tone={message.state === "refused" ? "danger" : undefined}
          >
            {reason === undefined ? time : `${time} · ${reason}`}
          </span>
        </span>
        {pill !== null && (
          <div className="dshb-ui-row-trailing">
            <StatusPill tone={pill.tone} label={pill.label} />
          </div>
        )}
      </div>
      <div
        className="dshb-groups-message-body dshb-mv-markdown"
        data-folded={long && !open ? "" : undefined}
      >
        <MarkdownView source={message.text} />
      </div>
      {long && (
        <div className="dshb-groups-message-fold">
          <Button variant="row" onClick={() => setOpen(!open)} expanded={open}>
            {open ? t("groups.message.less") : t("groups.message.more")}
          </Button>
        </div>
      )}
    </div>
  )
}
