/** What deleting a bot leaves to clean up: its sessions (and a legacy Workspace registration). */
export interface BotSessions {
  name: string
  mainSessionId?: string | undefined
  /** Every session recorded for the bot. */
  sessionIds: readonly string[]
  /** Legacy (version 1 record): the Workspace once registered for the bot's Host directory. */
  workspaceId?: string | undefined
}

export interface SessionCleanupDeps {
  /** Archive one session, stopping its running work. Already archived ids resolve. */
  archive(sessionId: string): Promise<void>
  /** Delete a legacy Workspace registration; its session logs stay. */
  deleteWorkspace(workspaceId: string): Promise<unknown>
}

/** Thrown when a deleted bot's sessions could not all be cleaned up. */
export class BotCleanupError extends Error {
  constructor(bot: BotSessions, failures: readonly string[]) {
    super(
      `"${bot.name}" を削除しましたが、セッションを片付けられませんでした / "${bot.name}" was deleted, but its sessions could not be cleaned up: ${failures.join("; ")}`,
    )
    this.name = "BotCleanupError"
  }
}

/**
 * Archive every session of a deleted bot (its Main included), so none is left
 * in the sidebar's Ungrouped list, then drop a legacy Workspace registration.
 *
 * Every session is attempted even after a failure; the legacy Workspace goes
 * only once all of them are archived.
 * @throws {BotCleanupError} naming every step that failed.
 */
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
