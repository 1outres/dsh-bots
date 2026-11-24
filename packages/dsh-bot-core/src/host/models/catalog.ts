/**
 * What DSH can run, read from its LLM registry the way its own model picker
 * and `session.selectModel` read it (dsh-api-session-controller
 * `buildModelCatalog`, `modelAvailable`): a registered provider, a model it
 * advertises (`listModels`), and an effort `resolveCallConfig` accepts.
 */
import type {
  BotModelCatalog,
  BotModelOffer,
  BotModelProviderFailure,
  BotModelProviderOffer,
  BotModelSelection,
  BotModelsErrorCode,
} from "../../shared/models"

/** The slice of DSH's `llm` service (dsh-llm `LlmRuntime`) this module reads. */
export interface LlmRegistry {
  listProviders(): readonly { readonly id: string; readonly name: string }[]
  listModels(
    provider: string,
  ): Promise<
    readonly { readonly id: string; readonly name: string; readonly description?: string }[]
  >
  resolveModelInfo(
    provider: string,
    model: string,
  ): Promise<{
    readonly reasoning?: {
      readonly efforts: readonly {
        readonly id: string
        readonly name: string
        readonly description?: string
      }[]
      readonly defaultEffort?: string
    }
  }>
  resolveCallConfig(config: {
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<unknown>
}

/** Why DSH cannot run a route now. */
export interface BotModelProblem {
  readonly code: BotModelsErrorCode
  readonly message: string
}

export interface ModelCatalog {
  read(): Promise<BotModelCatalog>
  /** Whether DSH can run `selection` now; undefined when it can. */
  check(selection: BotModelSelection): Promise<BotModelProblem | undefined>
}

export interface ModelCatalogDeps {
  readonly llm: LlmRegistry
  /** DSH's default model now (`agentDefaultModel.currentSelection()`). */
  profileDefault(): BotModelSelection
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const routeLabel = (selection: BotModelSelection) =>
  `${selection.provider}/${selection.model}${selection.reasoningEffort === undefined ? "" : ` (${selection.reasoningEffort})`}`

export function createModelCatalog(deps: ModelCatalogDeps): ModelCatalog {
  const { llm } = deps

  const offer = async (
    provider: string,
    model: { id: string; name: string; description?: string },
  ): Promise<BotModelOffer> => {
    const { reasoning } = await llm.resolveModelInfo(provider, model.id)
    return {
      id: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      ...(reasoning === undefined
        ? {}
        : {
            reasoning: {
              efforts: reasoning.efforts.map((effort) => ({
                id: effort.id,
                name: effort.name,
                ...(effort.description === undefined ? {} : { description: effort.description }),
              })),
              ...(reasoning.defaultEffort === undefined
                ? {}
                : { defaultEffort: reasoning.defaultEffort }),
            },
          }),
    }
  }

  return {
    async read() {
      const listed = await Promise.all(
        llm
          .listProviders()
          .map(async (provider): Promise<BotModelProviderOffer | BotModelProviderFailure> => {
            try {
              const models = await llm.listModels(provider.id)
              return {
                id: provider.id,
                name: provider.name,
                models: await Promise.all(models.map((model) => offer(provider.id, model))),
              }
            } catch (error) {
              return { id: provider.id, name: provider.name, message: describe(error) }
            }
          }),
      )
      return {
        profileDefault: { ...deps.profileDefault() },
        providers: listed.filter(
          (item): item is BotModelProviderOffer => "models" in item && item.models.length > 0,
        ),
        failures: listed.filter((item): item is BotModelProviderFailure => "message" in item),
      }
    },
    async check(selection) {
      if (!llm.listProviders().some((provider) => provider.id === selection.provider)) {
        return {
          code: "bot-models/unknown-provider",
          message: `DSH has no LLM provider "${selection.provider}"`,
        }
      }
      let models: Awaited<ReturnType<LlmRegistry["listModels"]>>
      try {
        models = await llm.listModels(selection.provider)
      } catch (error) {
        return {
          code: "bot-models/catalog-failed",
          message: `the models of "${selection.provider}" could not be listed: ${describe(error)}`,
        }
      }
      if (!models.some((model) => model.id === selection.model)) {
        return {
          code: "bot-models/unknown-model",
          message: `the provider "${selection.provider}" does not offer the model "${selection.model}"`,
        }
      }
      if (selection.reasoningEffort !== undefined) {
        let efforts: readonly string[]
        try {
          const { reasoning } = await llm.resolveModelInfo(selection.provider, selection.model)
          efforts = reasoning?.efforts.map((effort) => effort.id) ?? []
        } catch (error) {
          return { code: "bot-models/rejected", message: describe(error) }
        }
        if (!efforts.includes(selection.reasoningEffort)) {
          return {
            code: "bot-models/invalid-effort",
            message:
              efforts.length === 0
                ? `${selection.provider}/${selection.model} takes no reasoning effort`
                : `${selection.provider}/${selection.model} takes the reasoning efforts ${efforts.join(", ")}, not "${selection.reasoningEffort}"`,
          }
        }
      }
      try {
        await llm.resolveCallConfig({ ...selection })
      } catch (error) {
        return { code: "bot-models/rejected", message: describe(error) }
      }
      return undefined
    },
  }
}
