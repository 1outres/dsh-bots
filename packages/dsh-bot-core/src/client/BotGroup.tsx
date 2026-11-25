import type { KeyboardEvent, MouseEvent } from "react"
import { Avatar } from "./Avatar"
import { BotSessionRow, SessionOverflowRow } from "./BotSessionRow"
import type { ActionProps } from "./face"
import { useObservable } from "./hooks"
import { IconEllipsis, IconNewChat, IconStar, IconTriangleRight } from "./icons"
import { localeFormat } from "./locale-format"
import { rowMenuOpener } from "./menu"
import { RowError } from "./RowError"
import { type BotNode, sessionKey } from "./tree"

interface GroupProps extends ActionProps {
  node: BotNode
  /** Key of the tree's single tab stop. */
  tabKey: string | undefined
  /** Position among the bots, for aria-posinset. */
  index: number
  count: number
}

const rowRect = (element: Element) => element.getBoundingClientRect()

/**
 * One bot: a level-1 treeitem, then, while expanded, Main, its other sessions
 * newest first within the bot's window, and the Show more / Show less row.
 */
export function BotGroup({ node, tabKey, index, count, ...props }: GroupProps) {
  const { t, status, openSession, newSession, clearError, setExpanded, windows } = props
  const { bot, key, expanded, sessions, overflow, mainSelected, childSelected, running } = node
  const size = 1 + sessions.length + (overflow === undefined ? 0 : 1)
  const botStatus = useObservable(status)[bot.id]
  const waiting = useObservable(props.waiting)[bot.id]
  const incidents = useObservable(props.incidents)[bot.id]
  const waitingText =
    waiting === undefined ? undefined : localeFormat(t).count("bot.waiting", waiting)
  const incidentsText =
    incidents === undefined ? undefined : localeFormat(t).count("bot.incidents", incidents)
  const description = [incidentsText, waitingText].filter((part) => part !== undefined).join(", ")
  const menuOpen = useObservable(props.menuBot) === bot.id
  const opener = rowMenuOpener(bot.id)
  const buttonExpanded = useObservable(props.menuOpener) === opener
  const rowSelected = !expanded && (mainSelected || childSelected)

  const openMenuFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.repeat) return
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return
    event.preventDefault()
    const rect = rowRect(event.currentTarget)
    props.openBotMenu(bot, { x: rect.left, y: rect.bottom }, undefined)
  }

  const stop = (event: MouseEvent) => event.stopPropagation()

  return (
    <>
      <div
        className="dshb-row dshb-bot-row"
        role="treeitem"
        aria-level={1}
        aria-setsize={count}
        aria-posinset={index + 1}
        aria-expanded={expanded}
        aria-selected={rowSelected}
        aria-label={bot.name}
        aria-description={description === "" ? undefined : description}
        tabIndex={tabKey === key ? 0 : -1}
        data-dshb-key={key}
        data-selected={rowSelected ? "" : undefined}
        data-menu-open={menuOpen ? "" : undefined}
        title={bot.name}
        onClick={() => openSession(bot.mainSessionId)}
        onKeyDown={openMenuFromKeyboard}
        onContextMenu={(event) => {
          event.preventDefault()
          props.openBotMenu(bot, { x: event.clientX, y: event.clientY }, undefined)
        }}
      >
        {/* Pointer-only expand control; keyboard users press → / ← on the row. */}
        <span
          className="dshb-slot dshb-toggle"
          data-open={expanded ? "" : undefined}
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation()
            setExpanded(bot.id, !expanded)
          }}
        >
          <span className="dshb-toggle-avatar">
            <Avatar avatar={bot.avatar} size={16} />
          </span>
          <span className="dshb-toggle-chevron">
            <IconTriangleRight />
          </span>
        </span>
        <span className="dshb-title">{bot.name}</span>
        {incidents !== undefined && (
          <span
            className="dshb-waiting"
            data-tone="danger"
            data-dshb-incidents=""
            title={incidentsText}
            role="img"
            aria-label={incidentsText}
          >
            {incidents}
          </span>
        )}
        {waiting !== undefined && (
          <span
            className="dshb-waiting"
            data-dshb-waiting=""
            title={waitingText}
            role="img"
            aria-label={waitingText}
          >
            {waiting}
          </span>
        )}
        {running && <span className="dshb-dot" />}
        {/* Hover actions as in Workspaces rows: the … menu, then New Session.
            Both stay out of the tab order; the menu key and Shift+F10 open the
            same menu from the row. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops clicks from opening the row */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops clicks from opening the row */}
        <span className="dshb-row-actions" onClick={stop}>
          <button
            type="button"
            className="dshb-row-button"
            tabIndex={-1}
            data-context-menu-trigger=""
            aria-label={t("bot.menu", { name: bot.name })}
            title={t("bot.menu", { name: bot.name })}
            aria-haspopup="menu"
            aria-expanded={buttonExpanded}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true })
              const rect = rowRect(event.currentTarget)
              props.openBotMenu(bot, { x: rect.left, y: rect.bottom }, opener)
            }}
          >
            <IconEllipsis />
          </button>
          <button
            type="button"
            className="dshb-row-button"
            tabIndex={-1}
            title={t("bot.newSession")}
            aria-label={t("bot.newSession.aria", { name: bot.name })}
            onClick={() => newSession(bot)}
          >
            <IconNewChat size={14} />
          </button>
        </span>
      </div>
      {botStatus?.error !== undefined && (
        <RowError t={t} message={botStatus.error} onDismiss={() => clearError(bot.id)} />
      )}
      {expanded && (
        // biome-ignore lint/a11y/useSemanticElements: an ARIA tree's group of treeitems
        <div className="dshb-children" role="group" aria-label={bot.name}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles keys for its treeitems */}
          <div
            className="dshb-row dshb-session-row"
            role="treeitem"
            aria-level={2}
            aria-setsize={size}
            aria-posinset={1}
            aria-selected={mainSelected}
            aria-description={t("bot.main.hint")}
            tabIndex={tabKey === sessionKey(bot.mainSessionId) ? 0 : -1}
            data-dshb-key={sessionKey(bot.mainSessionId)}
            data-selected={mainSelected ? "" : undefined}
            onClick={() => openSession(bot.mainSessionId)}
          >
            <span className="dshb-main-mark" title={t("bot.main.hint")}>
              <IconStar size={12} />
            </span>
            <span className="dshb-title">{t("bot.main")}</span>
          </div>
          {sessions.map((row, position) => (
            <BotSessionRow
              key={row.id}
              {...props}
              bot={bot}
              row={row}
              place={{ position: position + 2, size, tabKey }}
            />
          ))}
          {overflow !== undefined && (
            <SessionOverflowRow
              t={t}
              botId={bot.id}
              overflow={overflow}
              onToggle={() => windows.toggle(bot.id, overflow, node.window)}
              place={{ position: size, size, tabKey }}
            />
          )}
        </div>
      )}
    </>
  )
}
