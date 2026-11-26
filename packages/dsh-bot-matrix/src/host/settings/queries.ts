import type {
  BotChannelCheck,
  BotChannelInitial,
  BotChannelInitialRequest,
  BotChannelInitialSummary,
  BotChannelInspection,
  BotChannelOption,
  BotChannelOptions,
  BotChannelOptionsRequest,
  BotChannelSettingsRequest,
  BotChannelSharedRequest,
  BotChannelText,
} from "@1outres/dsh-bot-core"
import { DM_HOME, HOME_SOURCE, type MatrixSettings, OWNERS_SOURCE } from "../fields"
import {
  type Homeserver,
  HomeserverRefusal,
  homeserverOf,
  serviceIdentity,
  TOKEN_REFUSED,
} from "../homeserver"
import { botUserId, inNamespace, matrixTo, serverNameOf } from "../ids"
import { isMatrixError, type MatrixApi, type MatrixMember, type OpenMatrixApi } from "../matrix"
import type { AccountRecords } from "../records/accounts"
import type { HomeRecords } from "../records/homes"
import type { MatrixServer } from "../servers"
import type { MatrixShared } from "../shared-fields"
import { encodeBase64 } from "./base64"
import { roomFacts } from "./rooms"
import { MIN_VERSION, supportsVersion } from "./versions"

export interface MatrixSettingsQueriesDeps {
  readonly open: OpenMatrixApi
  readonly accounts: AccountRecords
  readonly homes: HomeRecords
}

type Request = BotChannelSettingsRequest<MatrixSettings, MatrixShared>
type OptionsRequest = BotChannelOptionsRequest<MatrixSettings, MatrixShared>
type SharedRequest = BotChannelSharedRequest<MatrixShared>

const ok: BotChannelCheck = { ok: true }
const refuse = (reason: BotChannelText): BotChannelCheck => ({ ok: false, reason })
const unavailable = (reason: BotChannelText): BotChannelOptions => ({
  state: "unavailable",
  reason,
})
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const unreachable = (error: unknown): BotChannelText => ({
  en: `The homeserver could not be asked: ${messageOf(error)}`,
  ja: `homeserver に問い合わせられませんでした: ${messageOf(error)}`,
})

export function registrationFile(prefix: string, serverName: string | undefined): string {
  const server = serverName === undefined ? "<server_name>" : serverName.replace(/\./g, "\\.")
  return [
    "id: dsh-bots",
    "url: null",
    "as_token: <as_token>",
    "hs_token: <hs_token>",
    `sender_localpart: ${prefix}`,
    "rate_limited: false",
    "namespaces:",
    "  users:",
    "    - exclusive: true",
    `      regex: "@${prefix}_.*:${server}"`,
    "  aliases: []",
    "  rooms: []",
    "",
  ].join("\n")
}

async function imageOf(api: MatrixApi, mxc: string | undefined, signal: AbortSignal) {
  if (mxc === undefined || !mxc.startsWith("mxc://")) return undefined
  const media = await api.thumbnail(mxc, 64, signal).catch(() => undefined)
  if (media === undefined || !/^image\/(png|jpeg|gif|webp)$/.test(media.contentType))
    return undefined
  return `data:${media.contentType};base64,${encodeBase64(media.data)}`
}

export function createMatrixSettingsQueries(deps: MatrixSettingsQueriesDeps) {
  const homeOf = (shared: MatrixShared) => homeserverOf(deps.open, shared)

  const botApi = async (home: Homeserver, botId: string, signal: AbortSignal) => {
    const account = deps.accounts.get(botId)
    if (account !== undefined && account.state === "active") {
      return { userId: account.userId, api: home.api.as(account.userId), exists: true }
    }
    const { serverName } = await serviceIdentity(home, signal)
    const userId = botUserId(home.prefix, botId, serverName)
    return { userId, api: home.api.as(userId), exists: false }
  }

  const personOf = async (
    api: MatrixApi,
    member: Pick<MatrixMember, "userId" | "displayName" | "avatarUrl">,
    signal: AbortSignal,
  ): Promise<BotChannelOption> => ({
    value: member.userId,
    label: { en: member.displayName ?? member.userId },
    detail: { en: member.userId },
    ...(await imageOf(api, member.avatarUrl, signal).then((image) =>
      image === undefined ? {} : { image },
    )),
  })

  const homeOptions = async (request: OptionsRequest): Promise<BotChannelOptions> => {
    const home = homeOf(request.shared)
    const bot = request.bot
    const dm: BotChannelOption = {
      value: DM_HOME,
      label: { en: "Direct chat", ja: "ダイレクトチャット" },
      detail: { en: "With the one owner", ja: "オーナー 1 人と" },
    }
    if (bot === undefined) return { state: "ready", options: [dm], suggested: [DM_HOME] }
    const { api, userId, exists } = await botApi(home, bot.id, request.signal)
    if (!exists) {
      return {
        state: "ready",
        options: [
          {
            ...dm,
            detail: {
              en: `To list a room here, turn Matrix on and connect first, then invite ${userId}`,
              ja: `部屋を候補に出すには、まず Matrix をオンにして接続し、${userId} を招待してください`,
            },
          },
        ],
        suggested: [DM_HOME],
      }
    }
    const rooms = await roomFacts(api, userId, request.signal)
    const options: BotChannelOption[] = [dm]
    for (const room of rooms) {
      if (room.encrypted) continue
      const image = await imageOf(api, room.avatarUrl, request.signal)
      options.push({
        value: room.roomId,
        label: { en: room.name },
        detail:
          room.membership === "join"
            ? { en: `Joined · ${room.members} people`, ja: `参加中 · ${room.members} 人` }
            : {
                en: `Invited by ${room.inviter ?? "someone"}`,
                ja: `${room.inviter ?? "だれか"} から招待`,
              },
        ...(image === undefined ? {} : { image }),
      })
    }
    return { state: "ready", options, suggested: [DM_HOME] }
  }

  const ownerOptions = async (request: OptionsRequest): Promise<BotChannelOptions> => {
    const home = homeOf(request.shared)
    const { defaultOwner } = request.shared
    const prefix = home.prefix
    const outsider = (userId: string) => !inNamespace(userId, prefix)
    const seen = new Set<string>()
    const options: BotChannelOption[] = []
    const add = async (
      api: MatrixApi,
      member: Pick<MatrixMember, "userId" | "displayName" | "avatarUrl">,
    ) => {
      if (seen.has(member.userId) || !outsider(member.userId)) return
      seen.add(member.userId)
      options.push(await personOf(api, member, request.signal))
    }
    const profileMember = async (api: MatrixApi, userId: string) => {
      const profile = await api.profile(userId, request.signal)
      return {
        userId,
        ...(profile?.displayName === undefined ? {} : { displayName: profile.displayName }),
        ...(profile?.avatarUrl === undefined ? {} : { avatarUrl: profile.avatarUrl }),
      }
    }
    const bot = request.bot
    const access =
      bot === undefined
        ? { api: home.api, userId: undefined, exists: false }
        : await botApi(home, bot.id, request.signal)
    const { api } = access
    const homeValue = request.settings.home
    if (homeValue !== "" && homeValue !== DM_HOME) {
      if (!access.exists)
        return unavailable({
          en: "Connect the bot first to list the room's members.",
          ja: "部屋のメンバーを出すには、先にボットを接続してください。",
        })
      let members: readonly MatrixMember[]
      try {
        members = await api.members(homeValue, request.signal)
      } catch (error) {
        if (isMatrixError(error, "forbidden") || isMatrixError(error, "not-found")) {
          return unavailable({
            en: "The bot is not in this room; invite it first.",
            ja: "ボットはこの部屋にいません。先に招待してください。",
          })
        }
        throw error
      }
      const present = members.filter(
        (member) => member.membership === "join" || member.membership === "invite",
      )
      const first = present.find((member) => member.userId === defaultOwner)
      if (first !== undefined) await add(api, first)
      for (const member of present) await add(api, member)
      return { state: "ready", options, suggested: first === undefined ? [] : [first.userId] }
    }
    if (defaultOwner !== "") await add(api, await profileMember(api, defaultOwner))
    for (const owner of request.settings.approvers) await add(api, await profileMember(api, owner))
    if (access.exists) {
      for (const room of await roomFacts(api, access.userId as string, request.signal)) {
        if (room.membership !== "join") continue
        for (const member of await api.members(room.roomId, request.signal).catch(() => [])) {
          if (member.membership === "join") await add(api, member)
        }
      }
    }
    return { state: "ready", options, suggested: defaultOwner === "" ? [] : [defaultOwner] }
  }

  const failedOptions = (error: unknown): BotChannelOptions => {
    if (error instanceof HomeserverRefusal) return unavailable(error.reason)
    if (isMatrixError(error, "token")) return unavailable(TOKEN_REFUSED)
    return unavailable(unreachable(error))
  }

  return {
    async options(request: OptionsRequest): Promise<BotChannelOptions> {
      try {
        if (request.source === HOME_SOURCE) return await homeOptions(request)
        if (request.source === OWNERS_SOURCE) return await ownerOptions(request)
      } catch (error) {
        return failedOptions(error)
      }
      return unavailable({ en: `no source "${request.source}"` })
    },

    async check(request: Request): Promise<BotChannelCheck> {
      const home = homeOf(request.shared)
      const { settings } = request
      try {
        if (settings.home === DM_HOME) {
          const [owner, ...others] = settings.approvers
          if (owner === undefined || others.length > 0) {
            return refuse({
              en: "A direct chat has exactly one owner.",
              ja: "ダイレクトチャットのオーナーはちょうど 1 人です。",
            })
          }
          if (inNamespace(owner, home.prefix)) {
            return refuse({
              en: `${owner} is one of the bots, not a person.`,
              ja: `${owner} はボットで、人ではありません。`,
            })
          }
          if ((await home.api.profile(owner, request.signal)) === undefined) {
            return refuse({
              en: `The homeserver knows no user ${owner}.`,
              ja: `homeserver に ${owner} というユーザーはいません。`,
            })
          }
          return ok
        }
        if (request.bot === undefined) return ok
        const { api, userId, exists } = await botApi(home, request.bot.id, request.signal)
        if (!exists) {
          return refuse({
            en: `Connect the bot in a direct chat first, then invite ${userId} to the room.`,
            ja: `先にダイレクトチャットで接続し、${userId} を部屋に招待してください。`,
          })
        }
        const facts = (await roomFacts(api, userId, request.signal)).find(
          (room) => room.roomId === settings.home,
        )
        if (facts === undefined) {
          return refuse({
            en: "The bot is not in this room; invite it first.",
            ja: "ボットはこの部屋にいません。先に招待してください。",
          })
        }
        if (facts.encrypted) {
          return refuse({
            en: "This room is encrypted; an encrypted room cannot be the home.",
            ja: "この部屋は暗号化されています。暗号化された部屋はホームにできません。",
          })
        }
        if (facts.membership === "join") {
          const members = await api.members(settings.home, request.signal)
          const present = new Set(
            members
              .filter((member) => member.membership === "join" || member.membership === "invite")
              .map((member) => member.userId),
          )
          const missing = settings.approvers.find((owner) => !present.has(owner))
          if (missing !== undefined) {
            return refuse({
              en: `${missing} is not a member of this room.`,
              ja: `${missing} はこの部屋のメンバーではありません。`,
            })
          }
        }
        return ok
      } catch (error) {
        if (error instanceof HomeserverRefusal) return refuse(error.reason)
        return refuse(unreachable(error))
      }
    },

    async inspect(request: Request): Promise<BotChannelInspection> {
      const bot = request.bot
      if (bot === undefined) return { state: "ready", links: [], warnings: [] }
      try {
        const home = homeOf(request.shared)
        const { userId, exists, api } = await botApi(home, bot.id, request.signal)
        const warnings: BotChannelText[] = []
        const links = []
        const dm = deps.homes.get(bot.id)
        if (request.settings.home === DM_HOME && dm !== undefined) {
          links.push({
            label: { en: "Open the direct chat", ja: "ダイレクトチャットを開く" },
            url: matrixTo(dm.roomId),
          })
        }
        if (exists && request.settings.home !== "" && request.settings.home !== DM_HOME) {
          const facts = (await roomFacts(api, userId, request.signal)).find(
            (room) => room.roomId === request.settings.home,
          )
          if (facts !== undefined && !facts.canPin) {
            warnings.push({
              en: "The bot cannot pin messages in this room, so its list of pending approvals is not pinned.",
              ja: "ボットはこの部屋でピン留めできないので、承認待ちの一覧はピン留めされません。",
            })
          }
          if (facts?.federated) {
            warnings.push({
              en: "This room has people of other servers: what the bot posts there reaches their servers too.",
              ja: "この部屋にはほかのサーバーの人がいます。ボットが出すものはそのサーバーにも渡ります。",
            })
          }
        }
        if (!exists) {
          warnings.push({
            en: "The bot's Matrix account is made when Matrix is turned on.",
            ja: "ボットの Matrix アカウントは、Matrix をオンにしたときに作ります。",
          })
        }
        return {
          state: "ready",
          account: exists ? userId : `${userId} (not made yet)`,
          links: [
            ...links,
            {
              label: {
                en: "Invite this id to a room to list it as a home",
                ja: "この ID を部屋に招待すると、ホームの候補に出ます",
              },
              url: `https://matrix.to/#/${userId}`,
            },
          ],
          warnings,
        }
      } catch (error) {
        return {
          state: "unavailable",
          reason: error instanceof HomeserverRefusal ? error.reason : unreachable(error),
        }
      }
    },

    async checkShared(request: SharedRequest): Promise<BotChannelCheck> {
      const home = homeOf(request.shared)
      try {
        const versions = await home.api.versions(request.signal)
        if (!supportsVersion(versions)) {
          return refuse({
            en: `The homeserver speaks no Client-Server API version from ${MIN_VERSION} (authenticated media).`,
            ja: `homeserver が Client-Server API の ${MIN_VERSION} 以上（認証付きメディア）に対応していません。`,
          })
        }
        if ((await home.server.identify(home.api, request.signal)) === undefined) {
          return refuse({
            en: `${request.shared.homeserver} does not look like ${home.server.label.en}.`,
            ja: `${request.shared.homeserver} は ${home.server.label.ja ?? home.server.label.en} ではないようです。`,
          })
        }
        const identity = await serviceIdentity(home, request.signal)
        const moved = deps.accounts
          .list()
          .find(
            (account) =>
              account.state === "active" &&
              (account.serverName !== identity.serverName ||
                !inNamespace(account.userId, home.prefix)),
          )
        if (moved !== undefined) {
          return refuse({
            en: "Bots have Matrix accounts here, so the homeserver and the prefix cannot change. Delete those bots, or keep the same homeserver and prefix.",
            ja: "Matrix のアカウントを持つボットがあるので変えられません。それらのボットを削除するか、同じ homeserver と接頭辞のままにしてください。",
          })
        }
        const owner = request.shared.defaultOwner
        if (
          owner !== "" &&
          inNamespace(owner, home.prefix) &&
          serverNameOf(owner) === identity.serverName
        ) {
          return refuse({
            en: `${owner} is in the bots' namespace, not a person.`,
            ja: `${owner} はボットの名前空間のユーザーで、人ではありません。`,
          })
        }
        return ok
      } catch (error) {
        if (error instanceof HomeserverRefusal) return refuse(error.reason)
        return refuse(unreachable(error))
      }
    },

    async inspectShared(request: SharedRequest): Promise<BotChannelInspection> {
      const prefix = request.shared.prefix === "" ? "dshbots" : request.shared.prefix
      const warnings: BotChannelText[] = []
      let serverName: string | undefined
      let account: string | undefined
      let server: MatrixServer | undefined
      try {
        server = request.shared.server === "" ? undefined : homeOf(request.shared).server
      } catch {
        server = undefined
      }
      if (
        request.shared.homeserver !== "" &&
        request.shared.asToken !== "" &&
        request.shared.server !== ""
      ) {
        try {
          const identity = await serviceIdentity(homeOf(request.shared), request.signal)
          serverName = identity.serverName
          account = identity.sender
        } catch (error) {
          warnings.push(error instanceof HomeserverRefusal ? error.reason : unreachable(error))
        }
      }
      if (server?.retirementNote !== undefined) warnings.push(server.retirementNote)
      return {
        state: "ready",
        ...(account === undefined ? {} : { account }),
        links: [],
        warnings,
        snippets: [
          {
            label:
              server === undefined
                ? { en: "Registration file", ja: "登録ファイル" }
                : {
                    en: `Registration file. ${server.registrationGuide.en}`,
                    ja: `登録ファイル。${server.registrationGuide.ja ?? server.registrationGuide.en}`,
                  },
            language: "yaml",
            text: registrationFile(prefix, serverName),
          },
        ],
      }
    },

    describeInitial(shared: MatrixShared): BotChannelInitialSummary {
      return shared.defaultOwner === ""
        ? {
            state: "unavailable",
            reason: {
              en: "Set a default owner first.",
              ja: "先に既定のオーナーを設定してください。",
            },
          }
        : {
            state: "ready",
            summary: {
              en: `direct chat with ${shared.defaultOwner}`,
              ja: `${shared.defaultOwner} との DM`,
            },
          }
    },

    async initialSettings(
      request: BotChannelInitialRequest<MatrixShared>,
    ): Promise<BotChannelInitial> {
      const owner = request.shared.defaultOwner
      if (owner === "")
        return {
          state: "unavailable",
          reason: { en: "No default owner is set.", ja: "既定のオーナーが設定されていません。" },
        }
      return {
        state: "ready",
        values: {
          home: DM_HOME,
          approvers: [owner],
          language: request.bot.language.toLowerCase().startsWith("ja") ? "ja" : "",
        },
        secrets: {},
        profileSync: true,
        summary: { en: `direct chat with ${owner}`, ja: `${owner} との DM` },
      }
    },
  }
}
