import { sessionsOfBot } from "../shared/bots"
import { type BotManagedSession, managedSessionOf } from "../shared/managed-sessions"
import type { BotsFace } from "./face"
import type { ManagedSessionsStore } from "./managed-sessions"
import type { MenuPoint } from "./menu"
import { MENU_ICON } from "./menu-icons"
import { derive, type Observable } from "./observable"
import type { BotSessionRef, SessionArchive } from "./session-archive"
import { snapshotOf } from "./session-classification"
import type { ClientContext, ContextMenus, MenuAction, MenuTarget, Translate } from "./types"

export const BOT_SESSION_MENU_TARGET = "bot-session"

export interface BotSessionMenuValue {
  readonly botId: string
  readonly sessionId: string
  readonly displayTitle: string
}

export const botSessionMenuTarget = (session: BotSessionRef): MenuTarget => ({
  kind: BOT_SESSION_MENU_TARGET,
  value: {
    botId: session.bot.id,
    sessionId: session.sessionId,
    displayTitle: session.title,
  } satisfies BotSessionMenuValue,
})

export function menuTargetSessionId(target: MenuTarget | null): string | undefined {
  if (target?.kind !== BOT_SESSION_MENU_TARGET) return undefined
  const value = target.value as Partial<BotSessionMenuValue> | null
  return typeof value?.sessionId === "string" ? value.sessionId : undefined
}

export interface SessionMenuOpener {
  readonly menuSession: Observable<string | undefined>
  openSessionMenu(session: BotSessionRef, point: MenuPoint): void
}

export function createSessionMenuOpener(
  menus: Pick<ContextMenus, "active" | "open">,
): SessionMenuOpener {
  return {
    menuSession: derive([menus.active], menuTargetSessionId),
    openSessionMenu: (session, point) => menus.open(botSessionMenuTarget(session), point),
  }
}

type ManagedActions = Pick<ManagedSessionsStore, "entrust" | "release" | "setAnswerer">

export function managedSessionMenuActions(
  session: BotSessionRef,
  managed: BotManagedSession | undefined,
  archived: boolean,
  actions: ManagedActions,
  t: Translate,
): MenuAction[] {
  const { bot, sessionId } = session
  if (managed === undefined) {
    return archived
      ? []
      : [
          {
            id: "entrust",
            label: t("session.entrust"),
            icon: { key: MENU_ICON.entrust },
            run: () => actions.entrust(bot.id, sessionId),
          },
        ]
  }
  const other = managed.answerer === "main" ? "owner" : "main"
  return [
    {
      id: "answerer",
      label: t(other === "owner" ? "session.answerer.owner" : "session.answerer.main"),
      icon: { key: other === "owner" ? MENU_ICON.answerOwner : MENU_ICON.answerMain },
      run: () => actions.setAnswerer(bot.id, sessionId, other),
    },
    {
      id: "release",
      label: t("session.release"),
      icon: { key: MENU_ICON.release },
      run: () => actions.release(bot.id, sessionId),
    },
  ]
}

export function botSessionMenuActions(
  session: BotSessionRef,
  archived: boolean,
  archive: Pick<SessionArchive, "archive" | "unarchive">,
  t: Translate,
): MenuAction[] {
  return archived
    ? [
        {
          id: "unarchive",
          label: t("session.unarchive"),
          icon: { key: MENU_ICON.unarchive },
          run: () => archive.unarchive(session.bot.id, session.sessionId),
        },
      ]
    : [
        {
          id: "archive",
          label: t("session.archive"),
          icon: { key: MENU_ICON.archive },
          run: () => archive.archive(session),
        },
      ]
}

export function registerBotSessionMenu(
  ctx: ClientContext,
  face: Pick<BotsFace, "bots" | "workspaces" | "managed">,
  archive: Pick<SessionArchive, "archive" | "unarchive">,
  t: Translate,
): void {
  ctx.effect(
    () =>
      ctx.contextMenus.register({
        id: "bot-core.session-actions",
        target: BOT_SESSION_MENU_TARGET,
        order: 100,
        observe: () => [face.bots, face.workspaces, face.managed],
        resolve: (target: BotSessionMenuValue) => {
          const bot = snapshotOf(face.bots.getSnapshot())?.bots.find(
            (item) => item.id === target.botId,
          )
          if (
            bot === undefined ||
            target.sessionId === bot.mainSessionId ||
            !sessionsOfBot(bot).includes(target.sessionId)
          ) {
            return []
          }
          const session: BotSessionRef = {
            bot,
            sessionId: target.sessionId,
            title: target.displayTitle,
          }
          const archived = face.workspaces
            .getSnapshot()
            .archivedSessionIds.includes(target.sessionId)
          const managed = managedSessionOf(face.managed.getSnapshot(), target.sessionId)
          const management = bot.formerMainIds.includes(target.sessionId)
            ? []
            : managedSessionMenuActions(
                session,
                managed?.botId === bot.id ? managed : undefined,
                archived,
                face.managed,
                t,
              )
          const [first, ...rest] = botSessionMenuActions(session, archived, archive, t)
          return first === undefined
            ? management
            : [...management, { ...first, separatorBefore: management.length > 0 }, ...rest]
        },
      }),
    "bot-core: session row menu",
  )
}
