import type { BotChannelAccountsRequest } from "@1outres/dsh-bot-core"
import { type Homeserver, HomeserverRefusal, homeserverOf, serviceIdentity } from "./homeserver"
import { botLocalpart, botUserId } from "./ids"
import { isMatrixError, type MatrixApi, type OpenMatrixApi } from "./matrix"
import type { AccountRecords } from "./records/accounts"
import { forgetBotRecords } from "./records/bots"
import type { MatrixTables } from "./records/domain"
import type { MatrixShared } from "./shared-fields"

export interface BotAccount {
  readonly userId: string
  readonly serverName: string
  readonly api: MatrixApi
  readonly created: boolean
}

export async function ensureAccount(
  home: Homeserver,
  records: AccountRecords,
  bot: { readonly id: string; readonly name: string },
  signal: AbortSignal,
): Promise<BotAccount> {
  const { serverName } = await serviceIdentity(home, signal)
  const userId = botUserId(home.prefix, bot.id, serverName)
  const known = records.get(bot.id)
  if (known !== undefined && known.state !== "active") {
    throw new Error(`the Matrix account of bot "${bot.name}" is being removed`)
  }
  let registered: "created" | "exists"
  try {
    registered = await home.api.register(botLocalpart(home.prefix, bot.id), signal)
  } catch (error) {
    if (isMatrixError(error, "exclusive")) {
      throw new HomeserverRefusal({
        en: `The registration file's users namespace does not hold "${userId}": make its regex @${home.prefix}_.*:${serverName} and restart the homeserver.`,
        ja: `登録ファイルの users の名前空間に「${userId}」が入っていません。regex を @${home.prefix}_.*:${serverName} にして homeserver を再起動してください。`,
      })
    }
    throw error
  }
  const api = home.api.as(userId)
  const created = registered === "created" || known === undefined || known.userId !== userId
  if (created) await api.setDisplayName(bot.name, signal)
  await records.activate(bot.id, userId, serverName)
  return { userId, serverName, api, created }
}

async function invitedRooms(api: MatrixApi, signal: AbortSignal): Promise<readonly string[]> {
  const sync = await api.sync({
    timeoutMs: 0,
    filter: {
      room: { timeline: { limit: 0 }, state: { lazy_load_members: true } },
      presence: { not_types: ["*"] },
    },
    signal,
  })
  return [...sync.invited.keys()]
}

async function vacate(api: MatrixApi, signal: AbortSignal): Promise<void> {
  const rooms = new Set([...(await api.joinedRooms(signal)), ...(await invitedRooms(api, signal))])
  for (const roomId of rooms) {
    await api.leave(roomId, signal).catch((error: unknown) => {
      if (!isMatrixError(error, "not-found") && !isMatrixError(error, "forbidden")) throw error
    })
    await api.forget(roomId, signal).catch((error: unknown) => {
      if (!isMatrixError(error, "not-found") && !isMatrixError(error, "forbidden")) throw error
    })
  }
  await api.setDisplayName("", signal)
  await api.setAvatarUrl("", signal)
}

export interface AccountCleanerDeps {
  readonly open: OpenMatrixApi
  readonly records: AccountRecords
  readonly tables: MatrixTables
  warn(message: string): void
}

export function createAccountCleaner(deps: AccountCleanerDeps) {
  return {
    async reconcile(request: BotChannelAccountsRequest<MatrixShared>): Promise<void> {
      const home = homeserverOf(deps.open, request.shared)
      for (const account of deps.records.list()) {
        if (request.listed(account.botId) || account.state === "retired") continue
        try {
          await deps.records.retiring(account.botId)
          const api = home.api.as(account.userId)
          await vacate(api, request.signal)
          const retirement = await home.server.retire(api, request.signal)
          await deps.records.retired(account.botId, retirement.kind)
          await forgetBotRecords(deps.tables, account.botId)
        } catch (error) {
          deps.warn(
            `bot-matrix: the Matrix account ${account.userId} of a deleted bot is not cleaned up yet (tried again later): ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    },
  }
}
