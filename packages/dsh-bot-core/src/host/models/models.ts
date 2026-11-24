import type { BotSessionModelRequest } from "../../contract"
import {
  applyModelsChange,
  type BotModelChoice,
  type BotModelSelection,
  type BotModelSettings,
  type BotModelsErrorCode,
  type BotModelsErrorPlace,
  type BotModelsView,
  DEFAULT_BOT_MODELS,
  fixedChoices,
  parseModelsChange,
  selectionOf,
} from "../../shared/models"
import { type ModelCatalog, routeLabel } from "./catalog"
import { isDelegate } from "./delegates"
import type { BotModelStore } from "./store"

/** A refused model setting or use; the `bots` Remote reports its code. */
export class BotModelsError extends Error {
  constructor(
    readonly code: BotModelsErrorCode,
    message: string,
    readonly place: BotModelsErrorPlace = {},
  ) {
    super(message)
    this.name = "BotModelsError"
  }
}

/** A session asked for a model the bot's delegates do not hold; nothing was created. */
export class BotSessionModelRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BotSessionModelRefusal"
  }
}

/** A malformed change (untrusted input). */
export class BotModelsInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BotModelsInputError"
  }
}

/**
 * The model a new session starts on. `profile-default` leaves the route to
 * DSH's default, read live as DSH's own sessions do until their first
 * request; `fixed` is recorded on the session when it is created.
 */
export type SessionModel =
  | { readonly kind: "profile-default" }
  | { readonly kind: "fixed"; readonly selection: BotModelSelection }

export interface BotModels {
  view(botId: string): BotModelsView
  /** A new bot's settings from its creation's (untrusted) change, checked; nothing is stored. */
  initial(change: unknown): Promise<BotModelSettings>
  /** Check and store an (untrusted) change; nothing is stored when any choice is refused. */
  configure(botId: string, change: unknown): Promise<BotModelsView>
  /** The route a choice names now, checked against DSH's registry. */
  resolve(choice: BotModelChoice): Promise<BotModelSelection>
  /**
   * The model a session of the bot starts on: its `main` role or one of its
   * `delegates`, checked.
   * @throws when the request names a choice the delegates do not hold, or DSH cannot run it.
   */
  sessionModel(botId: string, request: BotSessionModelRequest): Promise<SessionModel>
}

export interface BotModelsDeps {
  readonly store: BotModelStore
  readonly catalog: ModelCatalog
  /** DSH's default model now. */
  profileDefault(): BotModelSelection
  /** Whether the bot is stored. */
  exists(botId: string): boolean
}

const parse = (change: unknown) => {
  try {
    return parseModelsChange(change)
  } catch (error) {
    throw new BotModelsInputError(error instanceof Error ? error.message : String(error))
  }
}

const where = (place: BotModelsErrorPlace) =>
  place.role === undefined
    ? ""
    : `${place.role}${place.index === undefined ? "" : `[${place.index}]`}: `

export function createBotModels(deps: BotModelsDeps): BotModels {
  const { store, catalog } = deps

  const requireBot = (botId: string) => {
    if (!deps.exists(botId) || !store.has(botId)) {
      throw new BotModelsError("bot-models/not-found", `bot "${botId}" does not exist`)
    }
  }

  const checked = async (selection: BotModelSelection, place: BotModelsErrorPlace = {}) => {
    const problem = await catalog.check(selection)
    if (problem !== undefined) {
      throw new BotModelsError(problem.code, `${where(place)}${problem.message}`, place)
    }
    return selection
  }

  const checkChange = async (change: ReturnType<typeof parseModelsChange>) => {
    for (const { place, selection } of fixedChoices(change)) await checked(selection, place)
  }

  const view = (botId: string): BotModelsView => {
    requireBot(botId)
    const stored = store.get(botId)
    return { botId, models: stored.models, mainPending: stored.mainPending }
  }

  return {
    view,
    async initial(change) {
      if (change === undefined) return DEFAULT_BOT_MODELS
      const parsed = parse(change)
      await checkChange(parsed)
      return applyModelsChange(DEFAULT_BOT_MODELS, parsed)
    },
    async configure(botId, change) {
      requireBot(botId)
      const parsed = parse(change)
      await checkChange(parsed)
      requireBot(botId)
      await store.configure(botId, parsed)
      return view(botId)
    },
    resolve: (choice) =>
      choice.kind === "fixed" ? checked(selectionOf(choice)) : checked(deps.profileDefault()),
    async sessionModel(botId, request) {
      requireBot(botId)
      const { main, delegates } = store.get(botId).models
      if (request.role === "delegate" && !isDelegate(delegates, request.choice)) {
        throw new BotSessionModelRefusal(
          `bot "${botId}" has no such delegate model; a session starts on its main model or one of its delegates`,
        )
      }
      const choice = request.role === "main" ? main : request.choice
      if (choice.kind === "profile-default") return { kind: "profile-default" }
      const selection = selectionOf(choice)
      const problem = await catalog.check(selection)
      if (problem !== undefined) {
        const role = request.role === "main" ? "main" : "delegates"
        throw new BotModelsError(
          problem.code,
          `bot "${botId}" cannot start a session on its ${request.role} model ${routeLabel(selection)}: ${problem.message}`,
          { role },
        )
      }
      return { kind: "fixed", selection }
    },
  }
}
