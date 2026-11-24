/**
 * A DSH session the Main session starts in a granted Workspace
 * (docs/specs/bot-managed-sessions.md §10.2): an ordinary Workspace session,
 * made by DSH's session controller in the Workspace's directory under the
 * grant's Agent preset, then given the grant's permission and the model before
 * anything is sent to it. It is never recorded as a bot's session.
 */
import type { BotModelChoice } from "../../shared/models"
import type { BotWorkspaceGrant } from "../../shared/workspaces"
import type { SessionModel } from "../models/models"

export interface WorkspaceSessionDeps<S> {
  /**
   * The model the session starts on.
   * @throws when DSH cannot run it; nothing is created then.
   */
  model(choice: BotModelChoice): Promise<SessionModel>
  /** `sessionController.create` in the Workspace: resolves to the session and the preset it runs. */
  create(request: {
    readonly workspaceId: string
    readonly agentPreset: string
  }): Promise<{ readonly sessionId: string; readonly agentPreset: string | undefined }>
  /** The created session's live DSH session. */
  session(sessionId: string): S
  /** Record the permission on it (host/permission.ts). */
  permit(session: S, grant: BotWorkspaceGrant): void
  /** Record a fixed model on it (`agent.model.select`). */
  select(sessionId: string, model: Extract<SessionModel, { readonly kind: "fixed" }>): void
  rename(sessionId: string, title: string): Promise<void>
  /** Archive a session that could not be set up, so nothing is left half made. */
  discard(sessionId: string): Promise<void>
  warn(message: string): void
}

export function createWorkspaceSessions<S>(deps: WorkspaceSessionDeps<S>) {
  return {
    /**
     * @throws when the model cannot run, DSH refuses the session, or it does
     *   not run the grant's preset or take its permission (it is archived then).
     */
    async create(
      grant: BotWorkspaceGrant,
      options: { readonly title: string; readonly model: BotModelChoice },
    ): Promise<string> {
      const model = await deps.model(options.model)
      const created = await deps.create({
        workspaceId: grant.workspaceId,
        agentPreset: grant.agentPreset,
      })
      try {
        if (created.agentPreset !== grant.agentPreset) {
          throw new Error(
            `the session runs Agent preset "${created.agentPreset ?? "(none)"}" instead of "${grant.agentPreset}"`,
          )
        }
        deps.permit(deps.session(created.sessionId), grant)
        if (model.kind === "fixed") deps.select(created.sessionId, model)
      } catch (error) {
        await deps.discard(created.sessionId).catch((discardError: unknown) => {
          deps.warn(
            `bot-core: could not archive session "${created.sessionId}": ${String(discardError)}`,
          )
        })
        throw error
      }
      try {
        await deps.rename(created.sessionId, options.title)
      } catch (error) {
        deps.warn(`bot-core: could not title session "${created.sessionId}": ${String(error)}`)
      }
      return created.sessionId
    },
  }
}
