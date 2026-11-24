import {
  BOT_MODEL_ROLE_IDS,
  type BotModelChoice,
  type BotModelSettings,
  type BotModelsChange,
  DEFAULT_BOT_MODELS,
  sameModelChoice,
} from "../../shared/models"
import type { BotTable } from "../registry"
import type { BotModelsRecord } from "./domain"

export interface BotModelStoreDeps {
  /** The models table of MODELS_DOMAIN; only this store writes it (design rule 51). */
  readonly models: BotTable<BotModelsRecord>
  now(): number
}

/** One bot's stored models. */
export interface StoredBotModels {
  readonly models: BotModelSettings
  readonly mainPending: boolean
}

export interface BotModelStore {
  /**
   * Give every bot of `botIds` without a row {@link DEFAULT_BOT_MODELS}, and
   * every row its missing roles' defaults (start-up, before anything reads).
   */
  migrate(botIds: Iterable<string>): Promise<void>
  /** @throws when the bot has no row (an unknown bot). */
  get(botId: string): StoredBotModels
  has(botId: string): boolean
  /** A new bot's row. @throws when it has one. */
  create(botId: string, settings: BotModelSettings): Promise<void>
  /** Replace the roles the change names; naming `main` marks it pending for the Main session. */
  configure(botId: string, change: BotModelsChange): Promise<StoredBotModels>
  /** The Main session took `applied`: clears the pending mark unless `main` changed since. */
  markApplied(botId: string, applied: BotModelChoice): Promise<void>
  /** Delete one row (a creation rolled back). */
  discard(botId: string): Promise<void>
  /** Delete the rows of bots that no longer exist. */
  purge(exists: (botId: string) => boolean): Promise<void>
  /** Called with the bot id after its row changed. */
  subscribe(listener: (botId: string) => void): () => void
}

/** The migration's completion of a row: every missing role at its default. */
function withDefaults(roles: BotModelsRecord["roles"]): BotModelSettings {
  return {
    main: roles.main ?? DEFAULT_BOT_MODELS.main,
    utility: roles.utility ?? DEFAULT_BOT_MODELS.utility,
    delegates: roles.delegates ?? DEFAULT_BOT_MODELS.delegates,
  }
}

const missingRoles = (roles: BotModelsRecord["roles"]) =>
  BOT_MODEL_ROLE_IDS.filter((role) => roles[role] === undefined)

/** A row's settings; every role is there once {@link BotModelStore.migrate} ran. */
function settingsOf(botId: string, roles: BotModelsRecord["roles"]): BotModelSettings {
  const { main, utility, delegates } = roles
  if (main === undefined || utility === undefined || delegates === undefined) {
    throw new Error(
      `the model settings of bot "${botId}" lack ${missingRoles(roles).join(", ")}; they are completed at start-up`,
    )
  }
  return { main, utility, delegates }
}

function rolesOf(settings: BotModelSettings): BotModelsRecord["roles"] {
  return { main: settings.main, utility: settings.utility, delegates: [...settings.delegates] }
}

export function createBotModelStore(deps: BotModelStoreDeps): BotModelStore {
  const { models } = deps
  const listeners = new Set<(botId: string) => void>()
  const publish = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const require = (botId: string): BotModelsRecord => {
    const record = models.get(botId)
    if (record === undefined) throw new Error(`bot "${botId}" has no model settings`)
    return record
  }
  const view = (botId: string, record: BotModelsRecord): StoredBotModels => ({
    models: settingsOf(botId, record.roles),
    mainPending: record.mainPending === true,
  })
  const write = async (botId: string, record: BotModelsRecord) => {
    await models.put(botId, record)
    publish(botId)
  }

  return {
    migrate: (botIds) =>
      serial(async () => {
        for (const botId of botIds) {
          const record = models.get(botId)
          if (record === undefined) {
            await write(botId, { roles: rolesOf(DEFAULT_BOT_MODELS), updatedAt: deps.now() })
          } else if (missingRoles(record.roles).length > 0) {
            await write(botId, { ...record, roles: rolesOf(withDefaults(record.roles)) })
          }
        }
      }),
    get: (botId) => view(botId, require(botId)),
    has: (botId) => models.get(botId) !== undefined,
    create: (botId, settings) =>
      serial(async () => {
        if (models.get(botId) !== undefined) {
          throw new Error(`bot "${botId}" already has model settings`)
        }
        await write(botId, { roles: rolesOf(settings), updatedAt: deps.now() })
      }),
    configure: (botId, change) =>
      serial(async () => {
        const current = require(botId)
        const next: BotModelsRecord = {
          roles: rolesOf({ ...settingsOf(botId, current.roles), ...change }),
          ...(change.main !== undefined || current.mainPending === true
            ? { mainPending: true as const }
            : {}),
          updatedAt: deps.now(),
        }
        await write(botId, next)
        return view(botId, next)
      }),
    markApplied: (botId, applied) =>
      serial(async () => {
        const current = models.get(botId)
        if (current?.mainPending !== true) return
        if (!sameModelChoice(settingsOf(botId, current.roles).main, applied)) return
        const { mainPending: _pending, ...rest } = current
        await write(botId, { ...rest, updatedAt: deps.now() })
      }),
    discard: (botId) =>
      serial(async () => {
        if (models.get(botId) === undefined) return
        await models.delete(botId)
        publish(botId)
      }),
    purge: (exists) =>
      serial(async () => {
        for (const [botId] of [...models.entries()]) {
          if (exists(botId)) continue
          await models.delete(botId)
          publish(botId)
        }
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
