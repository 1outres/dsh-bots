import type { BotCreateInput, BotUpdateInput, BotView } from "../../shared/bots"
import { type ArchivedViewStore, createArchivedViewStore } from "../archived-view"
import { BotsAction } from "../BotsSection"
import type { BotDeletion } from "../bot-deletion"
import { SLOT } from "../dsh/slots"
import { createExpansionStore, type ExpansionStore } from "../expansion"
import type { BotsFace, PendingActions } from "../face"
import { globalSettingsAttention } from "../global-settings/attention"
import { FORMAT_LOCALE_KEY } from "../locale-format"
import type { MainsClient } from "../mains/client"
import type { ManagedSessionsStore } from "../managed-sessions"
import type { BotMenuOpener } from "../menu"
import { ModelsError, refusalOf } from "../models/feed"
import type { NoticeStore } from "../notices"
import type { Store } from "../observable"
import type { SessionArchive } from "../session-archive"
import type { SessionMenuOpener } from "../session-menu"
import { createSessionWindows, type SessionWindows } from "../session-window"
import type { Registrations } from "../slot-registration"
import { createStatusStore, type StatusStore } from "../status"
import type { BotsStore } from "../store"
import type { ClientContext, RemoteResult } from "../types"
import type { DialogStores } from "./dialogs"
import { NAMESPACE } from "./plugin"
import type { SettingsScreens } from "./screens"

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message ?? "request refused")
  return result.value
}

/** What the user can do to bots, through the `bots` Remote; failures of row actions land in `status`. */
export interface BotActions {
  readonly status: StatusStore
  readonly expansion: ExpansionStore
  readonly archivedView: ArchivedViewStore
  readonly windows: SessionWindows
  setExpanded(botId: string, open: boolean): void
  /** Never rejects: the outcome is a notice, a refusal lands on the bot's row. */
  startNewMain(bot: BotView): Promise<void>
  setArchivedShown(botId: string, shown: boolean): void
  newSession(bot: BotView): Promise<void>
  /** The browser adds its language (its `format.locale`); a refused model rejects with a `ModelsError`. */
  createBot(input: Omit<BotCreateInput, "language">): Promise<void>
  saveBot(id: string, change: BotUpdateInput): Promise<void>
  /**
   * Never rejects: resolves once the Host accepted the removal, after which the
   * bot's row shows it until done; a refusal lands in `status`, on the bot's row.
   */
  removeBot(id: string): Promise<void>
  readonly pending: PendingActions
  clearError(id: string): void
}

export function createBotActions(
  ctx: ClientContext,
  bots: BotsStore,
  progress: Store<string | null>,
  mains: Pick<MainsClient, "startNew">,
  notices: Pick<NoticeStore, "show">,
): BotActions {
  const status = createStatusStore()
  const expansion = createExpansionStore()
  const archivedView = createArchivedViewStore()
  const windows = createSessionWindows()
  const setExpanded = (botId: string, open: boolean) => {
    if (!open) windows.reset(botId)
    expansion.set(botId, open)
  }
  const remote = () => {
    const face = bots.remote()
    if (face === undefined) throw new Error("bots are unavailable")
    return face
  }
  /** A request on a bot's row: a refusal is shown on the row. */
  const onRow = (id: string, request: () => Promise<RemoteResult<unknown>>) => {
    void (async () => {
      try {
        unwrap(await request())
        status.set(id, undefined)
      } catch (error) {
        status.set(id, { error: messageOf(error) })
      }
    })()
  }
  return {
    status,
    expansion,
    archivedView,
    windows,
    setExpanded,
    async startNewMain(bot) {
      try {
        const outcome = await mains.startNew(bot.id)
        if (outcome.outcome === "refused") {
          status.set(bot.id, { error: outcome.message })
          return
        }
        status.set(bot.id, undefined)
        notices.show({
          kind: outcome.outcome === "started" ? "main-started" : "main-unchanged",
          name: bot.name,
        })
        if (outcome.outcome === "started") ctx.uiWorkspace.openSession(outcome.sessionId)
      } catch (error) {
        status.set(bot.id, { error: messageOf(error) })
      }
    },
    setArchivedShown(botId, shown) {
      archivedView.set(botId, shown)
      if (shown) setExpanded(botId, true)
    },
    async newSession(bot) {
      setExpanded(bot.id, true)
      // Through the Host (Bot.createSession): the stock draft's preset picker
      // would compose the default preset in the bot's workspace.
      try {
        const { sessionId } = unwrap(await remote().createSession(bot.id))
        status.set(bot.id, undefined)
        ctx.uiWorkspace.openSession(sessionId)
      } catch (error) {
        status.set(bot.id, { error: messageOf(error) })
      }
    },
    async createBot(input) {
      const language = ctx.locale.bind(NAMESPACE)(FORMAT_LOCALE_KEY)
      const result = await remote().create({ ...input, language })
      if (!result.ok) {
        const refusal = refusalOf(result.error)
        throw refusal.kind === "refused" ? new ModelsError(refusal) : new Error(refusal.message)
      }
      progress.set(result.value.id)
    },
    async saveBot(id, change) {
      unwrap(await remote().update(id, change))
    },
    async removeBot(id) {
      try {
        unwrap(await remote().removeBot(id))
        status.set(id, undefined)
      } catch (error) {
        status.set(id, { error: messageOf(error) })
      }
    },
    pending: {
      retryCreate: (id) => onRow(id, () => remote().retryCreate(id)),
      discardCreate: (id) => onRow(id, () => remote().discardCreate(id)),
      retryRemove: (id) => onRow(id, () => remote().retryRemove(id)),
      dismissRemove: (id) => onRow(id, () => remote().dismissRemove(id)),
    },
    clearError: (id) => status.set(id, undefined),
  }
}

export interface BotsFaceSources {
  readonly bots: BotsStore
  readonly registrations: Registrations
  readonly actions: BotActions
  readonly dialogs: Pick<DialogStores, "createDialog">
  readonly screens: Pick<SettingsScreens, "openSettings" | "openGlobalSettings" | "global">
  readonly menu: BotMenuOpener
  readonly sessionMenu: SessionMenuOpener
  readonly archive: SessionArchive
  readonly notices: Pick<NoticeStore, "show">
  readonly progress: Store<string | null>
  readonly waiting: BotsFace["waiting"]
  readonly deletion: Pick<BotDeletion, "ask">
  readonly managed: ManagedSessionsStore
}

export function createBotsFace(ctx: ClientContext, sources: BotsFaceSources): BotsFace {
  const { bots, registrations, actions, dialogs, screens, menu, sessionMenu, progress, waiting } =
    sources
  return {
    bots,
    registrations,
    status: actions.status,
    waiting,
    sessions: ctx.sessions.list,
    workspaces: ctx.workspaces.list,
    openSession(sessionId) {
      progress.set(null)
      ctx.uiWorkspace.openSession(sessionId)
    },
    notifyArchivedNotOpenable: () => sources.notices.show({ kind: "archived-not-openable" }),
    newSession: (bot) => void actions.newSession(bot),
    createBot: actions.createBot,
    pending: actions.pending,
    progress,
    openProgress: (botId) => progress.set(botId),
    clearError: actions.clearError,
    openSettings: (botId, section) => screens.openSettings(botId, section),
    confirmDelete: (botId) => sources.deletion.ask(botId),
    openGlobalSettings: () => screens.openGlobalSettings(),
    globalSettingsAttention: globalSettingsAttention(screens.global.sections),
    createDialog: dialogs.createDialog,
    expansion: actions.expansion,
    setExpanded: actions.setExpanded,
    archivedView: actions.archivedView,
    setArchivedShown: actions.setArchivedShown,
    startNewMain: (bot) => void actions.startNewMain(bot),
    windows: actions.windows,
    archive: sources.archive,
    managed: sources.managed,
    menuBot: menu.menuBot,
    menuOpener: menu.menuOpener,
    openBotMenu: menu.openBotMenu,
    menuSession: sessionMenu.menuSession,
    openSessionMenu: sessionMenu.openSessionMenu,
  }
}

/** The Bots section, carried by the New Session row's `sidebar.session.action` layer. */
export function wireBotsSection(ctx: ClientContext, face: BotsFace): void {
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT.sessionAction, () =>
        ctx.slots.register(
          {
            name: SLOT.sessionAction,
            id: "bot-core",
            order: 100,
            locale: NAMESPACE,
            inject: () => face,
          },
          BotsAction,
        ),
      ),
    "bot-core: sidebar section",
  )
}
