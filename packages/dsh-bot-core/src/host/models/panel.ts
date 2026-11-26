import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import type { BotModelCatalog, BotModelsErrorDetails, BotModelsView } from "../../shared/models"
import type { ModelCatalog } from "./catalog"
import { type BotModels, BotModelsError, BotModelsInputError } from "./models"

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap extends BotModelsErrorDetails {}
}

export interface ModelPanel {
  view(botId: unknown): BotModelsView
  configure(botId: unknown, change: unknown): Promise<BotModelsView>
  catalog(): Promise<BotModelCatalog>
  subscribe(listener: (botId: string) => void): () => void
}

export interface ModelPanelDeps {
  readonly models: BotModels
  readonly catalog: ModelCatalog
  subscribe(listener: (botId: string) => void): () => void
}

const bad = (message: string) => new RemoteError("gateway/bad-request", message, {})

export function remoteModelsError(error: unknown): unknown {
  if (error instanceof BotModelsInputError) return bad(error.message)
  if (error instanceof BotModelsError)
    return new RemoteError(error.code, error.message, error.place)
  return error
}

const botIdOf = (botId: unknown) => {
  if (typeof botId !== "string" || botId.length === 0) throw bad("the bot id must be text")
  return botId
}

export function createModelPanel(deps: ModelPanelDeps): ModelPanel {
  return {
    view(botId) {
      try {
        return deps.models.view(botIdOf(botId))
      } catch (error) {
        throw remoteModelsError(error)
      }
    },
    async configure(botId, change) {
      try {
        return await deps.models.configure(botIdOf(botId), change)
      } catch (error) {
        throw remoteModelsError(error)
      }
    },
    catalog: () => deps.catalog.read(),
    subscribe: deps.subscribe,
  }
}
