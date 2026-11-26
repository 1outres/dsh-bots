import {
  type APIApplication,
  type APIGuild,
  type APIGuildChannel,
  type APIGuildMember,
  type APIUser,
  ApplicationFlags,
  ChannelType,
  DiscordAPIError,
  type GuildChannelType,
  OverwriteType,
  REST,
  RESTJSONErrorCodes,
  Routes,
} from "discord.js"
import {
  type DiscordApplicationInfo,
  type DiscordChannelInfo,
  type DiscordGuildInfo,
  type DiscordLookup,
  DiscordLookupError,
  type DiscordMemberInfo,
  type DiscordUserInfo,
  MEMBERS_LIMIT,
  type OpenDiscordLookup,
} from "../discord"

const MEMBERS_PAGE = 1000
const GONE: ReadonlySet<number> = new Set([
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownUser,
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.MissingAccess,
])

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function failureOf(error: unknown, listing: boolean): DiscordLookupError {
  if (error instanceof DiscordAPIError) {
    if (error.status === 401) return new DiscordLookupError("token-rejected", error.message)
    if (listing && error.code === RESTJSONErrorCodes.MissingAccess) {
      return new DiscordLookupError("members-intent", error.message)
    }
  }
  return new DiscordLookupError("unreachable", messageOf(error))
}

const missing = (error: unknown) =>
  error instanceof DiscordAPIError && typeof error.code === "number" && GONE.has(error.code)

export function openDiscordJsLookup(
  token: string,
  rest = new REST({ version: "10" }),
): DiscordLookup {
  rest.setToken(token)

  const get = async <T>(route: `/${string}`, signal: AbortSignal, query?: URLSearchParams) => {
    try {
      return (await rest.get(route, { signal, ...(query === undefined ? {} : { query }) })) as T
    } catch (error) {
      signal.throwIfAborted()
      throw failureOf(error, false)
    }
  }
  const find = async <T>(route: `/${string}`, signal: AbortSignal): Promise<T | undefined> => {
    try {
      return (await rest.get(route, { signal })) as T
    } catch (error) {
      signal.throwIfAborted()
      if (missing(error)) return undefined
      throw failureOf(error, false)
    }
  }

  const userOf = (user: APIUser, nick?: string | null): DiscordUserInfo => ({
    id: user.id,
    username: user.username,
    displayName: nick ?? user.global_name ?? user.username,
    avatarUrl:
      user.avatar === null
        ? rest.cdn.defaultAvatar(Number((BigInt(user.id) >> 22n) % 6n))
        : rest.cdn.avatar(user.id, user.avatar, { size: 64, extension: "png" }),
    bot: user.bot === true,
  })
  const memberOf = (member: APIGuildMember): DiscordMemberInfo => ({
    user: userOf(member.user, member.nick),
    roles: member.roles,
  })
  const channelOf = (
    channel: APIGuildChannel<GuildChannelType>,
    guildId: string,
  ): DiscordChannelInfo => ({
    id: channel.id,
    guildId,
    name: channel.name,
    text: channel.type === ChannelType.GuildText,
    overwrites: (channel.permission_overwrites ?? []).map((overwrite) => ({
      id: overwrite.id,
      kind: overwrite.type === OverwriteType.Role ? "role" : "member",
      allow: BigInt(overwrite.allow),
      deny: BigInt(overwrite.deny),
    })),
  })

  return {
    async application(signal) {
      const app = await get<APIApplication>(Routes.currentApplication(), signal)
      const bot = await get<APIUser>(Routes.user(), signal)
      const flags = app.flags
      const on = (...bits: ApplicationFlags[]) => bits.some((bit) => (flags & bit) !== 0)
      const team = app.team
      const owners =
        team === null || team === undefined
          ? app.owner === undefined
            ? []
            : [userOf(app.owner)]
          : [...team.members]
              .sort((a, b) =>
                a.user.id === team.owner_user_id ? -1 : b.user.id === team.owner_user_id ? 1 : 0,
              )
              .map((member) => userOf(member.user))
      return {
        id: app.id,
        bot: userOf(bot),
        owners,
        intents: {
          members: on(
            ApplicationFlags.GatewayGuildMembers,
            ApplicationFlags.GatewayGuildMembersLimited,
          ),
          messageContent: on(
            ApplicationFlags.GatewayMessageContent,
            ApplicationFlags.GatewayMessageContentLimited,
          ),
        },
      } satisfies DiscordApplicationInfo
    },
    async guilds(signal) {
      const guilds = await get<readonly { id: string; name: string }[]>(Routes.userGuilds(), signal)
      return guilds.map((guild) => ({ id: guild.id, name: guild.name }))
    },
    async guild(guildId, signal) {
      const guild = await find<APIGuild>(Routes.guild(guildId), signal)
      if (guild === undefined) return undefined
      return {
        id: guild.id,
        name: guild.name,
        ...(guild.icon === null
          ? {}
          : { iconUrl: rest.cdn.icon(guild.id, guild.icon, { size: 64, extension: "png" }) }),
        ownerId: guild.owner_id,
        roles: guild.roles.map((role) => ({ id: role.id, permissions: BigInt(role.permissions) })),
      } satisfies DiscordGuildInfo
    },
    async channels(guildId, signal) {
      const channels = await get<readonly APIGuildChannel<GuildChannelType>[]>(
        Routes.guildChannels(guildId),
        signal,
      )
      return channels.map((channel) => channelOf(channel, guildId))
    },
    async member(guildId, userId, signal) {
      const member = await find<APIGuildMember>(Routes.guildMember(guildId, userId), signal)
      return member === undefined ? undefined : memberOf(member)
    },
    async members(guildId, signal) {
      const members: DiscordMemberInfo[] = []
      let after = "0"
      while (members.length < MEMBERS_LIMIT) {
        let page: readonly APIGuildMember[]
        try {
          page = (await rest.get(Routes.guildMembers(guildId), {
            signal,
            query: new URLSearchParams({ limit: String(MEMBERS_PAGE), after }),
          })) as readonly APIGuildMember[]
        } catch (error) {
          signal.throwIfAborted()
          throw failureOf(error, true)
        }
        members.push(...page.map(memberOf))
        const last = page.at(-1)
        if (page.length < MEMBERS_PAGE || last === undefined) break
        after = last.user.id
      }
      return members.slice(0, MEMBERS_LIMIT)
    },
    async user(userId, signal) {
      const user = await find<APIUser>(Routes.user(userId), signal)
      return user === undefined ? undefined : userOf(user)
    },
  }
}

export const discordJsLookups: OpenDiscordLookup = (token) => openDiscordJsLookup(token)
