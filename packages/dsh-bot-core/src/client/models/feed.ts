import {
  BOT_MODEL_ROLE_IDS,
  BOT_MODELS_ERROR_CODES,
  type BotModelCatalog,
  type BotModelsChange,
  type BotModelsErrorCode,
  type BotModelsErrorPlace,
  type BotModelsView,
} from "../../shared/models"
import { followStream } from "../approvals/follow"
import { createFeedHub } from "../feed-hub"
import { createStore, type Observable } from "../observable"
import type { BotsRemote, RemoteMount } from "../remote"
import type { RemoteResult } from "../types"

export type ModelsFailure =
  | { readonly kind: "mount"; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | {
      readonly kind: "refused"
      readonly code: BotModelsErrorCode
      readonly place: BotModelsErrorPlace
      readonly message: string
    }
  | { readonly kind: "invalid"; readonly code: string | undefined; readonly message: string }

export class ModelsError extends Error {
  override readonly name = "ModelsError"
  constructor(readonly failure: ModelsFailure) {
    super(failure.message)
  }
}

export type ModelsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: BotModelsView }
  | { readonly status: "failed"; readonly failure: ModelsFailure }

export interface ModelsModel extends Observable<ModelsState> {
  configure(change: BotModelsChange): Promise<BotModelsView>
  dispose(): void
}

export interface ModelsFeed extends Observable<ModelsState> {
  configure(change: BotModelsChange): Promise<BotModelsView>
}

export interface ModelsHub {
  feed(botId: string): ModelsFeed
}

export interface ModelsModelDeps {
  readonly mount: Promise<RemoteMount>
  readonly generation: Observable<object | undefined>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isModelsCode = (code: string | undefined): code is BotModelsErrorCode =>
  (BOT_MODELS_ERROR_CODES as readonly (string | undefined)[]).includes(code)

function placeOf(details: unknown): BotModelsErrorPlace {
  if (typeof details !== "object" || details === null) return {}
  const { role, index } = details as { role?: unknown; index?: unknown }
  const known = BOT_MODEL_ROLE_IDS.find((id) => id === role)
  return {
    ...(known === undefined ? {} : { role: known }),
    ...(typeof index === "number" ? { index } : {}),
  }
}

export function refusalOf(
  error: Extract<RemoteResult<unknown>, { ok: false }>["error"],
): ModelsFailure {
  const message = error.message ?? error.code ?? "refused"
  return isModelsCode(error.code)
    ? { kind: "refused", code: error.code, place: placeOf(error.details), message }
    : { kind: "invalid", code: error.code, message }
}

async function botsOf(mount: Promise<RemoteMount>): Promise<BotsRemote> {
  const mounted = await mount
  if (mounted.status === "failed") throw new ModelsError({ kind: "mount", message: mounted.error })
  return mounted.remote.bots
}

async function call<T>(
  mount: Promise<RemoteMount>,
  run: (bots: BotsRemote) => Promise<RemoteResult<T>>,
): Promise<T> {
  const bots = await botsOf(mount)
  let result: RemoteResult<T>
  try {
    result = await run(bots)
  } catch (error) {
    throw new ModelsError({ kind: "connection", message: messageOf(error) })
  }
  if (result.ok) return result.value
  throw new ModelsError(refusalOf(result.error))
}

const failureOf = (error: unknown): ModelsFailure =>
  error instanceof ModelsError ? error.failure : { kind: "connection", message: messageOf(error) }

export function createModelsModel(deps: ModelsModelDeps, botId: string): ModelsModel {
  const state = createStore<ModelsState>({ status: "loading" })
  let disposed = false
  let stop: (() => void) | undefined

  void botsOf(deps.mount).then(
    (bots) => {
      if (disposed) return
      stop = followStream<BotModelsView>({
        generation: deps.generation,
        open: () => bots.watchModels(botId),
        item: (view) => state.set({ status: "ready", view }),
        lost(message) {
          if (state.getSnapshot().status === "ready" || message === undefined) return
          state.set({ status: "failed", failure: { kind: "connection", message } })
        },
      })
    },
    (error: unknown) => {
      if (!disposed) state.set({ status: "failed", failure: failureOf(error) })
    },
  )

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    configure: (change) => call(deps.mount, (bots) => bots.configureModels(botId, change)),
    dispose() {
      disposed = true
      stop?.()
    },
  }
}

export function createModelsHub(open: (botId: string) => ModelsModel): ModelsHub {
  return createFeedHub<ModelsState, ModelsModel, Pick<ModelsFeed, "configure">>({
    name: "models",
    idle: { status: "loading" },
    open,
    extend: (followed) => ({ configure: async (change) => followed().configure(change) }),
  })
}

export function modelCatalogReader(mount: Promise<RemoteMount>): () => Promise<BotModelCatalog> {
  return () => call(mount, (bots) => bots.modelCatalog())
}
