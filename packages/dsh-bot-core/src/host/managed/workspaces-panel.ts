import { parseManagedId } from "../../shared/managed-sessions"
import {
  type BotWorkspaceGrant,
  type BotWorkspaceOptions,
  type BotWorkspacesSnapshot,
  parseWorkspaceSettings,
  parseWorkspaceSettingsChange,
} from "../../shared/workspaces"
import type { WorkspaceGrants } from "./grants"

/** What the `botWorkspaces` Remote serves: the owner's grants (its input is untrusted). */
export interface WorkspacesPanel {
  snapshot(): BotWorkspacesSnapshot
  options(): Promise<BotWorkspaceOptions>
  grant(botId: unknown, workspaceId: unknown, settings: unknown): Promise<BotWorkspaceGrant>
  configure(botId: unknown, workspaceId: unknown, change: unknown): Promise<BotWorkspaceGrant>
  revoke(botId: unknown, workspaceId: unknown): Promise<BotWorkspacesSnapshot>
}

export function createWorkspacesPanel(deps: {
  readonly grants: WorkspaceGrants
  options(): Promise<BotWorkspaceOptions>
  /** Whether the bot is listed. */
  listed(botId: string): boolean
}): WorkspacesPanel {
  const ids = (botId: unknown, workspaceId: unknown) => {
    const bot = parseManagedId(botId, "botId")
    if (!deps.listed(bot)) throw new Error(`bot "${bot}" does not exist`)
    return [bot, parseManagedId(workspaceId, "workspaceId")] as const
  }
  return {
    snapshot: () => deps.grants.snapshot(),
    options: () => deps.options(),
    async grant(botId, workspaceId, settings) {
      const [bot, workspace] = ids(botId, workspaceId)
      return deps.grants.grant(bot, workspace, parseWorkspaceSettings(settings))
    },
    async configure(botId, workspaceId, change) {
      const [bot, workspace] = ids(botId, workspaceId)
      return deps.grants.configure(bot, workspace, parseWorkspaceSettingsChange(change))
    },
    async revoke(botId, workspaceId) {
      await deps.grants.revoke(...ids(botId, workspaceId))
      return deps.grants.snapshot()
    },
  }
}
