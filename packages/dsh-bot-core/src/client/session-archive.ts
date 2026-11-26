import type { BotView } from "../shared/bots"
import type { NoticeStore } from "./notices"
import { createStore, type Observable } from "./observable"
import type { StatusStore } from "./status"
import type { SessionActivity, SessionListState, UiWorkspaceFace } from "./types"

export interface BotSessionRef {
  readonly bot: BotView
  readonly sessionId: string
  readonly title: string
}

export interface ArchiveConfirmRequest {
  readonly session: BotSessionRef
  readonly activity: readonly SessionActivity[]
}

export interface SessionArchive {
  readonly confirming: Observable<ArchiveConfirmRequest | null>
  archive(session: BotSessionRef): void
  stopAndArchive(request: ArchiveConfirmRequest): Promise<void>
  settle(): void
  unarchive(botId: string, sessionId: string): void
}

export interface SessionArchiveSources {
  readonly workspace: Pick<UiWorkspaceFace, "archiveSession" | "unarchiveSession" | "openSession">
  readonly sessions: Observable<SessionListState>
  readonly status: Pick<StatusStore, "set">
  readonly notices: Pick<NoticeStore, "show">
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function shownSession(list: SessionListState): string | undefined {
  return list.ids.find((id) => (list.byId[id]?.retainedBy?.mainView ?? 0) > 0)
}

interface ArchiveRefusal {
  readonly name: string
  readonly rpcError?: {
    readonly code?: unknown
    readonly details?: { readonly activity?: readonly SessionActivity[] }
  }
}

export function activeSessionRefusal(reason: unknown): readonly SessionActivity[] | undefined {
  if (!(reason instanceof Error) || reason.name !== "WorkspaceArchiveError") return undefined
  const { rpcError } = reason as ArchiveRefusal
  if (rpcError?.code !== "workspace/session-active") return undefined
  return rpcError.details?.activity
}

export function createSessionArchive(sources: SessionArchiveSources): SessionArchive {
  const { workspace, sessions, status, notices } = sources
  const confirming = createStore<ArchiveConfirmRequest | null>(null)

  const archived = (session: BotSessionRef, wasShown: boolean) => {
    const { bot, sessionId } = session
    status.set(bot.id, undefined)
    const now = shownSession(sessions.getSnapshot())
    if (wasShown && (now === undefined || now === sessionId)) {
      workspace.openSession(bot.mainSessionId)
    }
    notices.show({ kind: "session-archived", botId: bot.id, sessionId })
  }

  const isShown = (sessionId: string) => shownSession(sessions.getSnapshot()) === sessionId

  return {
    confirming,
    archive(session) {
      const wasShown = isShown(session.sessionId)
      workspace.archiveSession(session.sessionId).then(
        () => archived(session, wasShown),
        (reason: unknown) => {
          const activity = activeSessionRefusal(reason)
          if (activity === undefined) {
            status.set(session.bot.id, { error: messageOf(reason) })
            return
          }
          confirming.set({ session, activity })
        },
      )
    },
    async stopAndArchive(request) {
      const { session } = request
      const wasShown = isShown(session.sessionId)
      await workspace.archiveSession(session.sessionId, { stopActivity: true })
      if (confirming.getSnapshot() === request) confirming.set(null)
      archived(session, wasShown)
    },
    settle: () => confirming.set(null),
    unarchive(botId, sessionId) {
      workspace.unarchiveSession(sessionId).then(
        () => status.set(botId, undefined),
        (reason: unknown) => status.set(botId, { error: messageOf(reason) }),
      )
    },
  }
}
