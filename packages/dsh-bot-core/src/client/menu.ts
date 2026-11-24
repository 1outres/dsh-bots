import type { BotView } from "../shared/bots"
import type { BotsFace } from "./face"
import { MENU_ICON } from "./menu-icons"
import { createStore, derive, type Observable } from "./observable"
import { snapshotOf } from "./session-classification"
import type {
  ClientContext,
  ContextMenus,
  MenuAction,
  MenuTarget,
  Translate,
  WorkspaceSnapshot,
} from "./types"

/** Context-menu target family of bot rows, registered with the host's `ctx.contextMenus`. */
export const BOT_MENU_TARGET = "bot"

export interface BotMenuValue {
  readonly botId: string
  readonly displayTitle: string
}

export interface MenuPoint {
  readonly x: number
  readonly y: number
}

export const botMenuTarget = (bot: BotView): MenuTarget => ({
  kind: BOT_MENU_TARGET,
  value: { botId: bot.id, displayTitle: bot.name } satisfies BotMenuValue,
})

/** The opener id of a bot row's … button. */
export const rowMenuOpener = (botId: string): string => `bot-core:row:${botId}`

/** The bot id of an open menu target, if it is a bot row's. */
export function menuTargetBotId(target: MenuTarget | null): string | undefined {
  if (target?.kind !== BOT_MENU_TARGET) return undefined
  const value = target.value as Partial<BotMenuValue> | null
  return typeof value?.botId === "string" ? value.botId : undefined
}

/** Which bot's menu is open and which of bot-core's buttons opened it. */
export interface BotMenuOpener {
  readonly menuBot: Observable<string | undefined>
  readonly menuOpener: Observable<string | undefined>
  /** Opens at `point`; a button passes its opener id, and activating the open menu's opener again closes it. */
  openBotMenu(bot: BotView, point: MenuPoint, opener: string | undefined): void
  dispose(): void
}

interface Opened {
  readonly opener: string
  readonly botId: string
}

/**
 * DSH's context menus keep the opener of the open popup to themselves (only
 * its own `contextMenu.button` reads it), so bot-core records the one it
 * passes and drops it once that bot's menu is no longer the open one.
 */
export function createBotMenuOpener(
  menus: Pick<ContextMenus, "active" | "open" | "close">,
): BotMenuOpener {
  const opened = createStore<Opened | undefined>(undefined)
  const menuBot = derive([menus.active], menuTargetBotId)
  const menuOpener = derive([opened, menuBot], (current, botId) =>
    current !== undefined && current.botId === botId ? current.opener : undefined,
  )
  const dispose = menuBot.subscribe(() => {
    if (opened.getSnapshot()?.botId !== menuBot.getSnapshot()) opened.set(undefined)
  })
  return {
    menuBot,
    menuOpener,
    openBotMenu(bot, point, opener) {
      if (opener !== undefined && menuOpener.getSnapshot() === opener) {
        menus.close()
        return
      }
      if (opener === undefined) {
        menus.open(botMenuTarget(bot), point)
        opened.set(undefined)
        return
      }
      menus.open(botMenuTarget(bot), point, { button: opener })
      opened.set({ opener, botId: bot.id })
    },
    dispose,
  }
}

type MenuFace = Pick<
  BotsFace,
  "newSession" | "openSettings" | "confirmDelete" | "setArchivedShown" | "startNewMain"
>

/** A bot's archived sessions as its menu offers them: whether they are listed, and whether it has any. */
export interface ArchivedSessions {
  readonly shown: boolean
  readonly any: boolean
}

/** Whether any of the bot's sessions is archived. */
export function hasArchivedSessions(bot: BotView, workspaces: WorkspaceSnapshot): boolean {
  return bot.sessionIds.some((id) => workspaces.archivedSessionIds.includes(id))
}

/**
 * Menu entries of one bot row: a new session and a new Main; while it has
 * archived sessions or lists them, whether they are listed; the bot's
 * settings, and Delete (the confirmation that asks for its name), separated.
 */
export function botMenuActions(
  bot: BotView,
  archived: ArchivedSessions,
  face: MenuFace,
  t: Translate,
): MenuAction[] {
  return [
    {
      id: "new-session",
      label: t("bot.newSession"),
      icon: { key: MENU_ICON.newSession },
      run: () => face.newSession(bot),
    },
    {
      id: "new-main",
      label: t("menu.newMain"),
      icon: { key: MENU_ICON.newMain },
      run: () => face.startNewMain(bot),
    },
    ...(archived.shown || archived.any
      ? [
          {
            id: "archived",
            label: t(archived.shown ? "menu.hideArchived" : "menu.showArchived"),
            icon: { key: archived.shown ? MENU_ICON.hideArchived : MENU_ICON.showArchived },
            run: () => face.setArchivedShown(bot.id, !archived.shown),
          },
        ]
      : []),
    {
      id: "settings",
      label: t("menu.settings"),
      icon: { key: MENU_ICON.settings },
      separatorBefore: true,
      run: () => face.openSettings(bot.id),
    },
    {
      id: "delete",
      label: t("menu.delete"),
      icon: { key: MENU_ICON.delete },
      danger: true,
      separatorBefore: true,
      run: () => face.confirmDelete(bot.id),
    },
  ]
}

/** Register the bot row menu with the host's shared context menu. */
export function registerBotMenu(
  ctx: ClientContext,
  face: Pick<BotsFace, "bots" | "archivedView" | "workspaces"> & MenuFace,
  t: Translate,
): void {
  ctx.effect(
    () =>
      ctx.contextMenus.register({
        id: "bot-core.actions",
        target: BOT_MENU_TARGET,
        order: 100,
        observe: () => [face.bots, face.archivedView, face.workspaces],
        resolve: (target: BotMenuValue) => {
          const bots = snapshotOf(face.bots.getSnapshot())?.bots
          const bot = bots?.find((item) => item.id === target.botId)
          if (bot === undefined) return []
          const archived = {
            shown: face.archivedView.getSnapshot()[bot.id] ?? false,
            any: hasArchivedSessions(bot, face.workspaces.getSnapshot()),
          }
          return botMenuActions(bot, archived, face, t)
        },
      }),
    "bot-core: row menu",
  )
}
