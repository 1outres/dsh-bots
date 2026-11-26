export interface BotSessions {
  name: string
  mainSessionId?: string | undefined
  sessionIds: readonly string[]
  workspaceId?: string | undefined
}

export interface SessionCleanupDeps {
  archive(sessionId: string): Promise<void>
  deleteWorkspace(workspaceId: string): Promise<unknown>
}

export class BotCleanupError extends Error {
  constructor(bot: BotSessions, failures: readonly string[]) {
    super(
      `"${bot.name}" を削除しましたが、セッションを片付けられませんでした / "${bot.name}" was deleted, but its sessions could not be cleaned up: ${failures.join("; ")}`,
    )
    this.name = "BotCleanupError"
  }
}

export async function cleanupBotSessions(
  deps: SessionCleanupDeps,
  bot: BotSessions,
): Promise<void> {
  const ids = new Set(bot.sessionIds)
  if (bot.mainSessionId !== undefined) ids.add(bot.mainSessionId)
  const failures: string[] = []
  for (const id of ids) {
    try {
      await deps.archive(id)
    } catch (error) {
      failures.push(`archive session ${id}: ${describe(error)}`)
    }
  }
  if (failures.length === 0 && bot.workspaceId !== undefined) {
    try {
      await deps.deleteWorkspace(bot.workspaceId)
    } catch (error) {
      failures.push(`delete workspace ${bot.workspaceId}: ${describe(error)}`)
    }
  }
  if (failures.length > 0) throw new BotCleanupError(bot, failures)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
