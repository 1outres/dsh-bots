import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { BotView } from "../../shared/bots"
import type {
  MainBotReply,
  MainMessageAuthor,
  MainPersonMessage,
  MainPresentedFile,
  MainPresentedFiles,
  MainTimelineFile,
  MainTimelineImage,
  MainTurnOutcome,
} from "../../shared/main-view"
import { Avatar } from "../Avatar"
import { MarkdownView } from "../files/MarkdownView"
import { useObservable } from "../hooks"
import { IconImage } from "../icons"
import { type LocaleFormat, localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { Button, ErrorText, Tag } from "../ui"
import type { TimelineImages } from "./images"
import type { TimelineFeed } from "./model"
import { type TimelineRow, timelineRows } from "./rows"
import type { EarlierState, ReadyTimeline } from "./state"

export interface MainTimelineProps {
  readonly t: Translate
  readonly bot: BotView
  readonly feed: TimelineFeed
  readonly images: TimelineImages
  /** Show a file of the bot's environment in the Files panel. */
  openFile(path: string): void
}

/** How close to the end of the scroll the reader counts as following it. */
const FOLLOW_SLACK_PX = 96
/** How close to the top an older page is read. */
const EARLIER_SLACK_PX = 480

const DAY_MS = 86_400_000

/**
 * The Main as its channels see it: people's messages and the bot's replies,
 * older pages read as the reader scrolls up, the end followed while the
 * reader is there.
 */
export function MainTimeline(props: MainTimelineProps) {
  const { t, feed } = props
  const state = useObservable(feed)
  if (state.status === "loading") {
    return (
      <div className="dshb-mv" data-dshb-main-view="" data-state="loading">
        <p className="dshb-mv-status" role="status">
          {t("mainView.loading")}
        </p>
      </div>
    )
  }
  if (state.status === "failed") {
    return (
      <div className="dshb-mv" data-dshb-main-view="" data-state="failed">
        <ErrorText>{t("mainView.failed", { message: state.message })}</ErrorText>
      </div>
    )
  }
  return <TimelineContent {...props} state={state} />
}

function scrollerOf(element: HTMLElement | null): HTMLElement | null {
  return element?.closest<HTMLElement>("[data-conversation-scroll]") ?? null
}

function TimelineContent(props: MainTimelineProps & { readonly state: ReadyTimeline }) {
  const { t, state, feed } = props
  const format = useMemo(() => localeFormat(t), [t])
  const rows = useMemo(() => timelineRows(state.items, format.dayOf), [state.items, format])
  const root = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const measured = useRef<{ first?: string; height: number }>({ height: 0 })
  const earlier = state.earlier

  useEffect(() => {
    const scroller = scrollerOf(root.current)
    if (scroller === null) return
    const onScroll = () => {
      following.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < FOLLOW_SLACK_PX
      if (scroller.scrollTop < EARLIER_SLACK_PX) feed.loadEarlier()
    }
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [feed])

  const first = state.items[0]?.id
  useLayoutEffect(() => {
    const scroller = scrollerOf(root.current)
    if (scroller === null) return
    const previous = measured.current
    if (following.current) {
      scroller.scrollTop = scroller.scrollHeight
    } else if (previous.first !== undefined && previous.first !== first) {
      scroller.scrollTop += scroller.scrollHeight - previous.height
    }
    measured.current = { ...(first === undefined ? {} : { first }), height: scroller.scrollHeight }
    if (scroller.scrollTop < EARLIER_SLACK_PX && earlier.kind === "more") feed.loadEarlier()
  })

  return (
    <div className="dshb-mv" data-dshb-main-view="" data-state="ready" ref={root}>
      <div
        className="dshb-mv-column"
        role="log"
        aria-label={t("mainView.label", { name: props.bot.name })}
      >
        <EarlierRow t={t} bot={props.bot} earlier={earlier} retry={feed.loadEarlier} />
        {rows.map((row) => (
          <Fragment key={row.key}>
            <Row {...props} row={row} format={format} />
          </Fragment>
        ))}
        {state.replying && <Typing t={t} bot={props.bot} />}
        {state.reconnecting && (
          <p className="dshb-mv-status" role="status">
            {t("mainView.reconnecting")}
          </p>
        )}
      </div>
    </div>
  )
}

function EarlierRow(props: {
  readonly t: Translate
  readonly bot: BotView
  readonly earlier: EarlierState
  retry(): void
}) {
  const { t, earlier } = props
  switch (earlier.kind) {
    case "none":
      return (
        <div className="dshb-mv-beginning" data-dshb-main-view-beginning="">
          <Avatar avatar={props.bot.avatar} size={48} />
          <h3 className="dshb-mv-beginning-name">{props.bot.name}</h3>
        </div>
      )
    case "more":
    case "loading":
      return (
        <p className="dshb-mv-status" role="status" data-dshb-main-view-earlier="">
          {t("mainView.earlier")}
        </p>
      )
    case "failed":
      return (
        <div className="dshb-mv-earlier-failed">
          <ErrorText>{t("mainView.earlierFailed", { message: earlier.message })}</ErrorText>
          <Button variant="row" onClick={props.retry}>
            {t("mainView.retry")}
          </Button>
        </div>
      )
  }
}

interface RowProps extends MainTimelineProps {
  readonly row: TimelineRow
  readonly format: LocaleFormat
}

function dayLabel(t: Translate, format: LocaleFormat, day: string): string {
  const now = Date.now()
  if (day === format.dayOf(now)) return t("mainView.today")
  if (day === format.dayOf(now - DAY_MS)) return t("mainView.yesterday")
  return format.day(day)
}

function Row(props: RowProps) {
  const { t, row, format } = props
  switch (row.kind) {
    case "day":
      return (
        <div className="dshb-mv-day">
          <span>{dayLabel(t, format, row.day)}</span>
        </div>
      )
    case "person":
      return <PersonGroup {...props} author={row.author} at={row.at} messages={row.messages} />
    case "bot":
      return <BotGroup {...props} at={row.at} entries={row.entries} />
    case "turn":
      return <TurnLine t={t} item={row.item} />
  }
}

function authorName(t: Translate, author: MainMessageAuthor): string {
  return author.kind === "web" ? t("mainView.you") : author.name
}

function routeOf(t: Translate, author: MainMessageAuthor): string {
  return author.kind === "web" ? t("mainView.web") : `${author.channel} · ${author.place}`
}

function PersonGroup(
  props: RowProps & {
    readonly author: MainMessageAuthor
    readonly at: number
    readonly messages: readonly MainPersonMessage[]
  },
) {
  const { t, author, format } = props
  return (
    <section className="dshb-mv-person" data-dshb-main-view-person={author.kind}>
      <header className="dshb-mv-meta">
        <span
          className="dshb-mv-name"
          title={author.kind === "channel" ? `@${author.handle}` : undefined}
        >
          {authorName(t, author)}
        </span>
        {author.kind === "channel" && author.owner && <Tag>{t("mainView.owner")}</Tag>}
        {author.kind === "channel" && author.bot && <Tag>{t("mainView.botSender")}</Tag>}
        <span className="dshb-mv-route">{routeOf(t, author)}</span>
        <time className="dshb-mv-time" dateTime={new Date(props.at).toISOString()}>
          {format.instant(props.at, "clock")}
        </time>
      </header>
      {props.messages.map((message) => (
        <div key={message.id} className="dshb-mv-message" data-dshb-main-view-item={message.id}>
          {message.images.length > 0 && (
            <div className="dshb-mv-images">
              {message.images.map((image) => (
                <Thumbnail
                  key={image.attachmentId}
                  {...props}
                  sessionId={message.sessionId}
                  image={image}
                  single={message.images.length === 1}
                />
              ))}
            </div>
          )}
          {message.files.length > 0 && (
            <div className="dshb-mv-files">
              {message.files.map((file, index) => (
                <FileChip key={`${file.name}:${index}`} {...props} file={file} />
              ))}
            </div>
          )}
          {message.text !== "" && <div className="dshb-mv-bubble">{message.text}</div>}
        </div>
      ))}
    </section>
  )
}

/** A lone image's box: its long edge 240px, never larger than the image itself. */
function thumbnailSize(image: MainTimelineImage, single: boolean) {
  if (!single) return { width: 96, height: 96 }
  const scale = Math.min(1, 240 / Math.max(image.width, image.height))
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  }
}

function Thumbnail(
  props: RowProps & {
    readonly sessionId: string
    readonly image: MainTimelineImage
    readonly single: boolean
  },
) {
  const { t, image, images, bot, sessionId } = props
  const [url, setUrl] = useState<string | "failed" | undefined>(undefined)
  useEffect(() => {
    let live = true
    images.load(bot.id, sessionId, image.attachmentId).then(
      (loaded) => {
        if (live) setUrl(loaded)
      },
      () => {
        if (live) setUrl("failed")
      },
    )
    return () => {
      live = false
    }
  }, [images, bot.id, sessionId, image.attachmentId])
  const size = thumbnailSize(image, props.single)
  const label = image.name ?? t("mainView.image")
  if (url === undefined || url === "failed") {
    return (
      <span
        className="dshb-mv-thumb"
        data-state={url ?? "loading"}
        style={size}
        title={label}
        role="img"
        aria-label={label}
      >
        <IconImage size={20} />
      </span>
    )
  }
  return (
    <a className="dshb-mv-thumb" href={url} target="_blank" rel="noopener noreferrer" title={label}>
      <img src={url} alt={label} width={size.width} height={size.height} draggable={false} />
    </a>
  )
}

function FileChip(props: RowProps & { readonly file: MainTimelineFile }) {
  const { file } = props
  const path = file.path
  const body = (
    <>
      <span className="dshb-mv-file-name">{file.name}</span>
      <span className="dshb-mv-file-meta">{file.size}</span>
    </>
  )
  return path === undefined ? (
    <span className="dshb-mv-file" title={file.name}>
      {body}
    </span>
  ) : (
    <button
      type="button"
      className="dshb-mv-file"
      title={path}
      onClick={() => props.openFile(path)}
    >
      {body}
    </button>
  )
}

function BotGroup(
  props: RowProps & {
    readonly at: number
    readonly entries: readonly (MainBotReply | MainPresentedFiles)[]
  },
) {
  const { t, bot, format } = props
  return (
    <section className="dshb-mv-bot" data-dshb-main-view-bot="">
      <span className="dshb-mv-avatar">
        <Avatar avatar={bot.avatar} size={28} />
      </span>
      <div className="dshb-mv-bot-body">
        <header className="dshb-mv-meta">
          <span className="dshb-mv-name">{bot.name}</span>
          <time className="dshb-mv-time" dateTime={new Date(props.at).toISOString()}>
            {format.instant(props.at, "clock")}
          </time>
        </header>
        {props.entries.map((entry) =>
          entry.kind === "reply" ? (
            <div key={entry.id} className="dshb-mv-reply" data-dshb-main-view-item={entry.id}>
              <div className="dshb-mv-markdown">
                <MarkdownView source={entry.text} />
              </div>
              {entry.interrupted && <p className="dshb-mv-note">{t("mainView.interrupted")}</p>}
            </div>
          ) : (
            <div key={entry.id} className="dshb-mv-files" data-dshb-main-view-item={entry.id}>
              {entry.files.map((file) => (
                <PresentedChip key={file.path} {...props} file={file} />
              ))}
            </div>
          ),
        )}
      </div>
    </section>
  )
}

function PresentedChip(props: RowProps & { readonly file: MainPresentedFile }) {
  const { file } = props
  return (
    <button
      type="button"
      className="dshb-mv-file"
      data-presented=""
      title={file.path}
      onClick={() => props.openFile(file.path)}
    >
      <span className="dshb-mv-file-name">{file.name}</span>
      {file.description !== undefined && (
        <span className="dshb-mv-file-meta">{file.description}</span>
      )}
    </button>
  )
}

function TurnLine({ t, item }: { readonly t: Translate; readonly item: MainTurnOutcome }) {
  const { outcome } = item
  return (
    <p className="dshb-mv-turn" data-outcome={outcome.kind}>
      <span className="dshb-mv-turn-dot" aria-hidden="true" />
      {outcome.kind === "failed"
        ? t("mainView.failedTurn", { message: outcome.message })
        : t("mainView.stoppedTurn")}
    </p>
  )
}

function Typing({ t, bot }: { readonly t: Translate; readonly bot: BotView }) {
  return (
    <div
      className="dshb-mv-typing"
      role="status"
      aria-label={t("mainView.typing", { name: bot.name })}
    >
      <span className="dshb-mv-avatar">
        <Avatar avatar={bot.avatar} size={28} />
      </span>
      <span className="dshb-mv-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}
