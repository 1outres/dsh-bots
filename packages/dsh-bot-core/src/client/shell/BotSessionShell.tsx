import { type ReactNode, useCallback, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import type { BotView } from "../../shared/bots"
import { ActionsPanel } from "../approvals/ActionsPanel"
import { ConnectorPanelView } from "../connector-panels/ConnectorPanel"
import { connectorEntries } from "../connector-panels/entries"
import type { ConversationContentInput, ConversationViewsProps } from "../dsh/conversation"
import { FACTORY, SLOT } from "../dsh/slots"
import { FilesPanel } from "../files/FilesPanel"
import { useObservable } from "../hooks"
import {
  MainConversationView,
  MainViewContext,
  type MainViewScope,
} from "../main-view/MainConversationView"
import { SessionLogPanel } from "../main-view/SessionLogPanel"
import { NotesPanel } from "../notes/NotesPanel"
import { derive, type Observable } from "../observable"
import { ShellWidthControls } from "../ShellWidthControls"
import { snapshotOf } from "../session-classification"
import { SETTINGS_SECTION } from "../settings/builtin"
import {
  ACTIONS_ENTRY_ID,
  byOrder,
  entryShown,
  FILES_ENTRY_ID,
  NOTES_ENTRY_ID,
  SESSION_LOG_ENTRY_ID,
  type ShellMenuContext,
  type ShellMenuEntry,
} from "../shell-menu"
import { botShellView, shellPhase } from "../shell-phase"
import type { Translate } from "../types"
import { useCompactLayout } from "../ui"
import { LOGINS_SECTION } from "../vaults/sections"
import type { ShellSlotProps } from "./face"
import { PreparingSession } from "./PreparingSession"
import { BotHeader, PendingHeader, SHELL_NAME_SELECTOR } from "./ShellHeader"
import {
  EntryButton,
  EntryMenuItem,
  type EntryRender,
  EntrySignal,
  PendingEntryButton,
  ShellMenuBar,
  ShellMenuButton,
} from "./ShellMenuBar"
import { BotErrorStatus, ConnectionStatus, IncidentStatus, ShellNotice } from "./ShellNotice"
import type { ShellBot } from "./shell-view"

/** The Factory's `views` position: Chat only, as DSH's embedded subagent chat (ui-subagent FixedChatConversationView). */
function ChatOnlyView(props: ConversationViewsProps) {
  return <>{props.renderSlot(SLOT.conversationSession, { view: "chat" })}</>
}

const CONTENT_SLOTS = { views: ChatOnlyView, widthControls: ShellWidthControls }

/** The Main's `views` position: what its channels see (docs/specs/bot-main-view.md). */
const MAIN_CONTENT_SLOTS = { views: MainConversationView, widthControls: ShellWidthControls }

export interface BotSessionShellProps extends Omit<ShellSlotProps, "sessionId" | "classification"> {
  readonly sessionId: string
  readonly bot: ShellBot
}

/** The menu's entries for a known bot's session: bot-core's it has, then the panels of the connectors it has on. */
function useKnownEntries(props: KnownProps, context: ShellMenuContext) {
  const { menu, connectorPanels } = props
  const feed = connectorPanels.connectors.feed(context.bot.id)
  return useMemo(
    () =>
      derive([menu, feed], (registered, state) => {
        const builtins = registered.filter((entry) => entryShown(entry, context))
        return state.status === "ready"
          ? [
              ...builtins,
              ...connectorEntries(
                state.snapshot.connectors,
                connectorPanels.places,
                connectorPanels.text,
              ),
            ].sort(byOrder)
          : builtins
      }),
    [menu, feed, connectorPanels.places, connectorPanels.text, context],
  )
}

/** The menu bar, or on a compact window its folded form in the header. */
interface ShellMenus {
  readonly bar: ReactNode
  readonly button: ReactNode
}

function menusOf(
  t: Translate,
  compact: boolean,
  entries: Observable<readonly ShellMenuEntry[]>,
  render: { readonly bar: EntryRender; readonly menu: EntryRender },
  signal?: (entry: ShellMenuEntry) => ReactNode,
): ShellMenus {
  return compact
    ? {
        bar: null,
        button: (
          <ShellMenuButton
            t={t}
            menu={entries}
            renderEntry={render.menu}
            {...(signal === undefined ? {} : { renderSignal: signal })}
          />
        ),
      }
    : { bar: <ShellMenuBar t={t} menu={entries} renderEntry={render.bar} />, button: null }
}

/**
 * A bot's session: its header, Chat only (or, while the session is being
 * prepared, a placeholder), banners over the transcript, the side panels and
 * the menu bar.
 */
export function BotSessionShell(props: BotSessionShellProps) {
  const { t, sessionId, useSession, useConversation, useSessions, renderFactorySlot } = props
  const session = useSession((value) => value)
  const conversation = useConversation((value) => value)
  const summaryBlank = useSessions((list) => list.byId[sessionId]?.blank)
  const sessionTitle = useSessions((list) => list.byId[sessionId]?.displayTitle)
  const known = props.bot.kind === "known" ? props.bot.bot : undefined
  const preparing = snapshotOf(useObservable(props.bots))?.preparingSessionIds
  const view = botShellView(
    shellPhase({ sessionId, session, conversation, summaryBlank }),
    known === undefined || preparing?.includes(sessionId) === true,
  )
  const phase = view.kind === "preparing" ? "hero" : view.phase
  const compact = useCompactLayout()
  const shellRef = useRef<HTMLDivElement>(null)
  const focusWithin = useCallback((selector: string) => {
    shellRef.current?.querySelector<HTMLElement>(selector)?.focus()
  }, [])
  const focusEntry = useCallback(
    (id: string) =>
      focusWithin(compact ? "[data-dshb-shell-menu-button]" : `[data-dshb-shell-entry="${id}"]`),
    [focusWithin, compact],
  )
  const focusName = useCallback(() => focusWithin(SHELL_NAME_SELECTOR), [focusWithin])
  const header = { t, sessionTitle, compact }
  return (
    <div
      ref={shellRef}
      className="dshb-shell"
      data-phase={phase}
      data-dshb-shell=""
      data-bot-id={known?.id}
    >
      <div className="dshb-shell-main">
        {known === undefined ? (
          <PendingShellHeader {...props} {...header} />
        ) : (
          <KnownShellHeader {...props} {...header} bot={known} />
        )}
        <div className="dshb-shell-banners" data-dshb-shell-banners="">
          <ConnectionStatus t={t} bots={props.bots} />
          {known !== undefined && <BotIncidents {...props} bot={known} />}
          {known !== undefined && <BotError {...props} bot={known} afterDismiss={focusName} />}
          <ShellNotice
            t={t}
            sessionId={sessionId}
            viewer={props.files.viewer}
            rightbarRegistration={props.rightbarRegistration}
            lockdownNotice={props.lockdownNotice}
            afterDismiss={focusName}
          />
        </div>
        {view.kind === "preparing" ? (
          <PreparingSession
            message={
              known === undefined
                ? t("shell.preparing.pending")
                : t("shell.preparing", { name: known.name })
            }
          />
        ) : (
          <ConversationContent {...props} phase={view.phase} hero={view.hero} known={known} />
        )}
      </div>
      <FilesPanel
        t={t}
        sessionId={sessionId}
        face={props.files}
        renderFactory={renderFactorySlot}
        containerRef={shellRef}
        returnFocus={() => focusEntry(FILES_ENTRY_ID)}
      />
      {known !== undefined && (
        <OpenSidePanel {...props} bot={known} containerRef={shellRef} returnFocus={focusEntry} />
      )}
      {known !== undefined && <OpenPopover {...props} bot={known} />}
      {known === undefined ? (
        <PendingShellBar {...props} compact={compact} />
      ) : (
        <KnownShellBar {...props} bot={known} compact={compact} />
      )}
    </div>
  )
}

/** DSH's conversation content: on the bot's Main its timeline, on its other sessions DSH's Chat. */
function ConversationContent(
  props: BotSessionShellProps & {
    readonly phase: ConversationContentInput["phase"]
    readonly hero: boolean
    readonly known: BotView | undefined
  },
) {
  const { t, sessionId, known: bot, mainView } = props
  const { viewer } = props.files
  const scope: MainViewScope | undefined = useMemo(
    () =>
      bot === undefined || bot.mainSessionId !== sessionId
        ? undefined
        : {
            t,
            bot,
            sessionId,
            face: mainView,
            openFile: (path: string) => viewer.openFile(sessionId, path),
          },
    [t, bot, sessionId, mainView, viewer],
  )
  const content = props.renderFactorySlot(
    FACTORY.conversationContent,
    { variant: "main", phase: props.phase, hero: props.hero } satisfies ConversationContentInput,
    { slots: scope === undefined ? CONTENT_SLOTS : MAIN_CONTENT_SLOTS },
  )
  return scope === undefined ? (
    content
  ) : (
    <MainViewContext.Provider value={scope}>{content}</MainViewContext.Provider>
  )
}

/** The shell's props for parts drawn only once the bot is known. */
type KnownProps = Omit<BotSessionShellProps, "bot">

interface HeaderInput {
  readonly t: Translate
  readonly sessionTitle: string | undefined
  readonly compact: boolean
}

function useKnownMenus(props: KnownProps, bot: BotView, compact: boolean): ShellMenus {
  const { t, sessionId } = props
  const context: ShellMenuContext = useMemo(() => ({ bot, sessionId }), [bot, sessionId])
  const entries = useKnownEntries(props, context)
  return menusOf(
    t,
    compact,
    entries,
    {
      bar: (entry, focus) => <EntryButton t={t} entry={entry} context={context} focus={focus} />,
      menu: (entry, focus, done) => (
        <EntryMenuItem t={t} entry={entry} context={context} focus={focus} done={done} />
      ),
    },
    (entry) => <EntrySignal entry={entry} context={context} />,
  )
}

function pendingMenus(props: BotSessionShellProps, compact: boolean): ShellMenus {
  const { t } = props
  const render: EntryRender = (entry, focus) => (
    <PendingEntryButton t={t} entry={entry} focus={focus} />
  )
  return menusOf(t, compact, props.menu, { bar: render, menu: render })
}

function KnownShellHeader(props: KnownProps & HeaderInput & { readonly bot: BotView }) {
  const menus = useKnownMenus(props, props.bot, props.compact)
  return (
    <BotHeader
      t={props.t}
      bot={props.bot}
      sessionTitle={props.sessionTitle === props.bot.name ? undefined : props.sessionTitle}
      openSettings={props.openSettings}
      menuButton={menus.button}
    />
  )
}

function PendingShellHeader(props: BotSessionShellProps & HeaderInput) {
  return (
    <PendingHeader
      t={props.t}
      sessionTitle={props.sessionTitle}
      menuButton={pendingMenus(props, props.compact).button}
    />
  )
}

function KnownShellBar(props: KnownProps & { readonly bot: BotView; readonly compact: boolean }) {
  return <>{useKnownMenus(props, props.bot, props.compact).bar}</>
}

function PendingShellBar(props: BotSessionShellProps & { readonly compact: boolean }) {
  return <>{pendingMenus(props, props.compact).bar}</>
}

function BotIncidents(props: KnownProps & { readonly bot: BotView }) {
  const count = useObservable(props.incidents)[props.bot.id]
  return (
    <IncidentStatus
      t={props.t}
      count={count}
      review={() => props.openSettings(props.bot.id, LOGINS_SECTION)}
    />
  )
}

function BotError(
  props: KnownProps & { readonly bot: BotView; readonly afterDismiss: () => void },
) {
  const error = useObservable(props.status)[props.bot.id]?.error
  if (error === undefined) return null
  return (
    <BotErrorStatus
      t={props.t}
      error={error}
      onDismiss={() => props.clearError(props.bot.id)}
      afterDismiss={props.afterDismiss}
    />
  )
}

/** The Actions or connector panel the session shows, if any. */
function OpenSidePanel(
  props: Omit<BotSessionShellProps, "bot"> & {
    readonly bot: BotView
    readonly containerRef: { readonly current: HTMLElement | null }
    readonly returnFocus: (entryId: string) => void
  },
) {
  const { t, bot, sessionId, connectorPanels, panels } = props
  const panel = useObservable(panels)[sessionId]
  if (panel === undefined) return null
  switch (panel.kind) {
    case "notes":
      return (
        <NotesPanel
          t={t}
          sessionId={sessionId}
          face={props.notes}
          containerRef={props.containerRef}
          close={() => {
            panels.close(sessionId)
            props.returnFocus(NOTES_ENTRY_ID)
          }}
        />
      )
    case "session-log":
      return (
        <SessionLogPanel
          t={t}
          sessionId={sessionId}
          face={props.mainView}
          containerRef={props.containerRef}
          close={() => {
            panels.close(sessionId)
            props.returnFocus(SESSION_LOG_ENTRY_ID)
          }}
        />
      )
    case "actions":
      return (
        <ActionsPanel
          t={t}
          text={connectorPanels.text}
          sessionId={sessionId}
          feed={props.approvals.feed(bot.id)}
          connectors={connectorPanels.connectors.feed(bot.id)}
          places={connectorPanels.places}
          width={props.actionsWidth}
          containerRef={props.containerRef}
          close={() => {
            panels.close(sessionId)
            props.returnFocus(ACTIONS_ENTRY_ID)
          }}
        />
      )
    case "connector":
      return (
        <ConnectorPanelView
          key={panel.connectorId}
          t={t}
          text={connectorPanels.text}
          bot={bot}
          sessionId={sessionId}
          connectorId={panel.connectorId}
          placement={{
            presentation: "side",
            width: connectorPanels.width,
            containerRef: props.containerRef,
          }}
          feed={connectorPanels.connectors.feed(bot.id)}
          renderSlot={props.renderSlot}
          openStream={connectorPanels.openStream}
          openSettings={() => props.openSettings(bot.id, SETTINGS_SECTION.connectors)}
          close={() => {
            panels.close(sessionId)
            props.returnFocus(`connector:${panel.connectorId}`)
          }}
        />
      )
  }
}

/** The connector panel the session shows as a popover over the app, if any. */
function OpenPopover(props: KnownProps & { readonly bot: BotView }) {
  const { t, bot, sessionId, connectorPanels, popovers } = props
  const popover = useObservable(popovers)[sessionId]
  const covered = useObservable(props.settingsStack).length > 0
  const host = useObservable(props.popoverHost)
  if (popover === undefined || host === null) return null
  return (
    <ConnectorPanelView
      key={popover.connectorId}
      t={t}
      text={connectorPanels.text}
      bot={bot}
      sessionId={sessionId}
      connectorId={popover.connectorId}
      placement={{
        presentation: "popover",
        covered,
        mount: (node) => createPortal(node, host),
      }}
      feed={connectorPanels.connectors.feed(bot.id)}
      renderSlot={props.renderSlot}
      openStream={connectorPanels.openStream}
      openSettings={() => props.openSettings(bot.id, SETTINGS_SECTION.connectors)}
      close={() => popovers.close(sessionId)}
    />
  )
}
