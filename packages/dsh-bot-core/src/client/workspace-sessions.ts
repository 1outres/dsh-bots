import { createElement } from "react"
import type { BotView } from "../shared/bots"
import { type BotManagedSession, managedSessionOf } from "../shared/managed-sessions"
import { type BotWorkspacesSnapshot, grantOf } from "../shared/workspaces"
import { useObservable } from "./hooks"
import { IconManaged } from "./icons"
import type { ManagedSessionsStore } from "./managed-sessions"
import { MENU_ICON } from "./menu-icons"
import type { Observable } from "./observable"
import { type BotsState, snapshotOf } from "./session-classification"
import type { ClientContext, MenuAction, Translate, WorkspaceSnapshot } from "./types"
import { NAMESPACE } from "./wiring/plugin"
import type { WorkspacesClient } from "./workspaces"

export const DSH_SESSION_MENU_TARGET = "session"

export const SESSION_ROW_TRAILING = "sidebar.session.row.trailing"

export interface WorkspaceSessionsFace {
  readonly bots: Observable<BotsState>
  readonly workspaces: Observable<WorkspaceSnapshot>
  readonly grants: Pick<WorkspacesClient, "getSnapshot" | "subscribe">
  readonly managed: ManagedSessionsStore
}

type ManagedActions = Pick<ManagedSessionsStore, "entrust" | "release" | "setAnswerer">

export function workspaceOfSession(
  workspaces: WorkspaceSnapshot,
  sessionId: string,
): string | undefined {
  return workspaces.items.find((workspace) => workspace.sessionIds.includes(sessionId))?.workspaceId
}

export function workspaceSessionMenuActions(input: {
  readonly sessionId: string
  readonly workspaceId: string | undefined
  readonly archived: boolean
  readonly bots: readonly BotView[]
  readonly grants: BotWorkspacesSnapshot | undefined
  readonly managed: BotManagedSession | undefined
  readonly actions: ManagedActions
  readonly t: Translate
}): MenuAction[] {
  const { sessionId, managed, actions, t } = input
  if (managed !== undefined) {
    const bot = input.bots.find((item) => item.id === managed.botId)
    if (bot === undefined || managed.target.kind !== "workspace") return []
    const other = managed.answerer === "main" ? "owner" : "main"
    return [
      {
        id: "answerer",
        label: t(other === "owner" ? "session.answerer.owner" : "workspaceSession.answerer.main", {
          bot: bot.name,
        }),
        icon: { key: other === "owner" ? MENU_ICON.answerOwner : MENU_ICON.answerMain },
        separatorBefore: true,
        run: () => actions.setAnswerer(bot.id, sessionId, other),
      },
      {
        id: "release",
        label: t("workspaceSession.release", { bot: bot.name }),
        icon: { key: MENU_ICON.release },
        run: () => actions.release(bot.id, sessionId),
      },
    ]
  }
  const { workspaceId, grants } = input
  if (input.archived || workspaceId === undefined || grants === undefined) return []
  const granted = input.bots.filter((bot) => grantOf(grants, bot.id, workspaceId) !== undefined)
  if (granted.length === 0) return []
  return [
    {
      id: "entrust",
      label: t("workspaceSession.entrust"),
      icon: { key: MENU_ICON.entrust },
      separatorBefore: true,
      children: granted.map((bot) => ({
        id: bot.id,
        label: bot.name,
        run: () => actions.entrust(bot.id, sessionId),
      })),
    },
  ]
}

export function registerWorkspaceSessionMenu(
  ctx: ClientContext,
  face: WorkspaceSessionsFace,
  t: Translate,
): void {
  ctx.effect(
    () =>
      ctx.contextMenus.register({
        id: "bot-core.workspace-session-management",
        target: DSH_SESSION_MENU_TARGET,
        order: 550,
        observe: () => [face.bots, face.workspaces, face.grants, face.managed],
        resolve: (target: { readonly sessionId: string }) => {
          const bots = snapshotOf(face.bots.getSnapshot())?.bots ?? []
          const workspaces = face.workspaces.getSnapshot()
          return workspaceSessionMenuActions({
            sessionId: target.sessionId,
            workspaceId: workspaceOfSession(workspaces, target.sessionId),
            archived: workspaces.archivedSessionIds.includes(target.sessionId),
            bots,
            grants: face.grants.getSnapshot(),
            managed: managedSessionOf(face.managed.getSnapshot(), target.sessionId),
            actions: face.managed,
            t,
          })
        },
      }),
    "bot-core: Workspace session menu",
  )
}

interface MarkProps extends WorkspaceSessionsFace {
  readonly sessionId: string
  readonly t: Translate
}

function WorkspaceManagedMark({ sessionId, managed, bots, t }: MarkProps) {
  const session = managedSessionOf(useObservable(managed), sessionId)
  const bot = snapshotOf(useObservable(bots))?.bots.find((item) => item.id === session?.botId)
  if (session?.target.kind !== "workspace" || bot === undefined) return null
  const label = t("workspaceSession.managed", { bot: bot.name })
  return createElement(
    "span",
    {
      className: "dshb-managed-mark",
      title: label,
      role: "img",
      "aria-label": label,
      "data-dshb-workspace-managed": session.botId,
    },
    createElement(IconManaged, { size: 12 }),
  )
}

export function registerWorkspaceManagedMark(
  ctx: ClientContext,
  face: WorkspaceSessionsFace,
): void {
  ctx.effect(
    () =>
      ctx.slots.inject(SESSION_ROW_TRAILING, () =>
        ctx.slots.register(
          {
            name: SESSION_ROW_TRAILING,
            id: "bot-core.workspace-managed",
            order: 900,
            locale: NAMESPACE,
            inject: () => face,
          },
          WorkspaceManagedMark,
        ),
      ),
    "bot-core: managed Workspace session mark",
  )
}
