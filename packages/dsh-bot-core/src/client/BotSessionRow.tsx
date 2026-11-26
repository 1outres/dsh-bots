import type { KeyboardEvent, MouseEvent } from "react"
import type { BotView } from "../shared/bots"
import type { ActionProps } from "./face"
import { useObservable } from "./hooks"
import { IconArchive, IconManaged, IconUnarchive } from "./icons"
import { localeFormat } from "./locale-format"
import type { BotSessionRef } from "./session-archive"
import type { SessionOverflow } from "./session-window"
import { overflowKey, type SessionLabel, type SessionRow, sessionKey, sessionLabel } from "./tree"
import type { Translate } from "./types"

export interface GroupPlace {
  readonly position: number
  readonly size: number
  readonly tabKey: string | undefined
}

function labelText(t: Translate, label: SessionLabel): string {
  switch (label.kind) {
    case "titled":
      return label.title
    case "untitled":
      return t("bot.untitled", { n: label.ordinal })
  }
}

const rowRect = (element: Element) => element.getBoundingClientRect()
const stop = (event: MouseEvent) => event.stopPropagation()

type RowFace = Pick<
  ActionProps,
  | "t"
  | "sessions"
  | "openSession"
  | "notifyArchivedNotOpenable"
  | "archive"
  | "menuSession"
  | "openSessionMenu"
  | "managed"
>

export function BotSessionRow(
  props: RowFace & { bot: BotView; row: SessionRow; place: GroupPlace },
) {
  const { t, bot, row, place } = props
  const summary = useObservable(props.sessions).byId[row.id]
  const menuOpen = useObservable(props.menuSession) === row.id
  const managed = useObservable(props.managed).sessions.some(
    (session) => session.sessionId === row.id && session.botId === bot.id,
  )
  const title = labelText(t, sessionLabel(bot, row.id, summary))
  const session: BotSessionRef = { bot, sessionId: row.id, title }
  const key = sessionKey(row.id)

  const activate = () => {
    if (row.archived) props.notifyArchivedNotOpenable()
    else props.openSession(row.id)
  }
  const openMenuFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.repeat) return
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return
    event.preventDefault()
    const rect = rowRect(event.currentTarget)
    props.openSessionMenu(session, { x: rect.left, y: rect.bottom })
  }
  const toggleLabel = row.archived
    ? t("session.unarchive.aria", { title })
    : t("session.archive.aria", { title })

  return (
    <div
      className="dshb-row dshb-session-row"
      role="treeitem"
      aria-level={2}
      aria-setsize={place.size}
      aria-posinset={place.position}
      aria-selected={row.selected}
      aria-label={title}
      aria-description={row.archived ? t("session.archived.hint") : undefined}
      tabIndex={place.tabKey === key ? 0 : -1}
      data-dshb-key={key}
      data-selected={row.selected ? "" : undefined}
      data-archived={row.archived ? "" : undefined}
      data-menu-open={menuOpen ? "" : undefined}
      title={title}
      onClick={activate}
      onKeyDown={openMenuFromKeyboard}
      onContextMenu={(event) => {
        event.preventDefault()
        props.openSessionMenu(session, { x: event.clientX, y: event.clientY })
      }}
    >
      <span className="dshb-main-mark" />
      <span className="dshb-title">{title}</span>
      {managed && (
        <span
          className="dshb-managed-mark"
          title={t("session.managed")}
          role="img"
          aria-label={t("session.managed")}
        >
          <IconManaged size={12} />
        </span>
      )}
      {row.running && <span className="dshb-dot" />}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: - */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: - */}
      <span className="dshb-row-actions" onClick={stop}>
        <button
          type="button"
          className="dshb-row-button"
          tabIndex={-1}
          aria-label={toggleLabel}
          title={row.archived ? t("session.unarchive.short") : t("session.archive.short")}
          data-dshb-archive-toggle={row.archived ? "unarchive" : "archive"}
          onClick={() =>
            row.archived ? props.archive.unarchive(bot.id, row.id) : props.archive.archive(session)
          }
        >
          {row.archived ? <IconUnarchive size={14} /> : <IconArchive size={14} />}
        </button>
      </span>
    </div>
  )
}

export function SessionOverflowRow(props: {
  readonly t: Translate
  readonly botId: string
  readonly overflow: SessionOverflow
  readonly onToggle: () => void
  readonly place: GroupPlace
}) {
  const { t, botId, overflow, place } = props
  const key = overflowKey(botId)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: -
    <div
      className="dshb-overflow"
      role="treeitem"
      aria-level={2}
      aria-setsize={place.size}
      aria-posinset={place.position}
      aria-selected={false}
      tabIndex={place.tabKey === key ? 0 : -1}
      data-dshb-key={key}
      data-dshb-overflow={overflow.kind}
      onClick={props.onToggle}
    >
      {overflow.kind === "more"
        ? localeFormat(t).count("sessions.expand", overflow.hidden)
        : t("sessions.collapse")}
    </div>
  )
}
