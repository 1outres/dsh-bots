import type { BotModelChoice } from "../../shared/models"
import type { BotWorkspaceGrant } from "../../shared/workspaces"
import type { SessionModel } from "../models/models"

export interface WorkspaceSessionDeps<S> {
  model(choice: BotModelChoice): Promise<SessionModel>
  create(request: {
    readonly workspaceId: string
    readonly agentPreset: string
  }): Promise<{ readonly sessionId: string; readonly agentPreset: string | undefined }>
  session(sessionId: string): S
  permit(session: S, grant: BotWorkspaceGrant): void
  select(sessionId: string, model: Extract<SessionModel, { readonly kind: "fixed" }>): void
  rename(sessionId: string, title: string): Promise<void>
  discard(sessionId: string): Promise<void>
  warn(message: string): void
}

export function createWorkspaceSessions<S>(deps: WorkspaceSessionDeps<S>) {
  return {
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
