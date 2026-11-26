import type {
  BotChannelCheck,
  BotChannelInspection,
  BotChannelOption,
  BotChannelOptions,
  BotChannelOptionsRequest,
  BotChannelSettingsRequest,
  BotChannelText,
} from "@1outres/dsh-bot-core"
import {
  type DiscordApplicationInfo,
  type DiscordChannelInfo,
  type DiscordGuildInfo,
  type DiscordLookup,
  DiscordLookupError,
  type DiscordUserInfo,
  type OpenDiscordLookup,
} from "../discord"
import type { DiscordSettings } from "../fields"
import { HOME_SOURCE, OWNERS_SOURCE } from "../fields"
import { channelHomeValue, type DiscordHomePlace, DM_HOME, homePlaceOf } from "../home"
import {
  HOME_PERMISSIONS,
  has,
  INVITE_PERMISSIONS,
  PERMISSION,
  permissionsIn,
} from "../permissions"
import { SETTINGS_TEXTS, settingsText } from "./texts"

type Request = BotChannelSettingsRequest<DiscordSettings>

export interface DiscordSettingsQueries {
  options(request: BotChannelOptionsRequest<DiscordSettings>): Promise<BotChannelOptions>
  check(request: Request): Promise<BotChannelCheck>
  inspect(request: Request): Promise<BotChannelInspection>
}

const unavailable = (reason: BotChannelText) => ({ state: "unavailable", reason }) as const

function reasonOf(error: unknown): BotChannelText {
  if (!(error instanceof DiscordLookupError)) throw error
  switch (error.failure) {
    case "token-rejected":
      return SETTINGS_TEXTS.tokenRejected
    case "members-intent":
      return SETTINGS_TEXTS.membersIntentOff
    case "unreachable":
      return settingsText("unreachable", { message: error.message })
  }
}

export const inviteUrl = (applicationId: string) =>
  `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`

export const portalUrl = (applicationId: string) =>
  `https://discord.com/developers/applications/${applicationId}/bot`

const named = (user: DiscordUserInfo) => `${user.displayName} (@${user.username})`

function personOption(user: DiscordUserInfo, appOwner: boolean): BotChannelOption {
  const handle = `@${user.username}`
  return {
    value: user.id,
    label: { en: user.displayName },
    detail: appOwner
      ? {
          en: `${handle} · ${SETTINGS_TEXTS.appOwner.en}`,
          ja: `${handle} · ${SETTINGS_TEXTS.appOwner.ja}`,
        }
      : { en: handle },
    image: user.avatarUrl,
  }
}

interface HomeChannel {
  readonly guild: DiscordGuildInfo
  readonly channel: DiscordChannelInfo
}

export function createDiscordSettingsQueries(open: OpenDiscordLookup): DiscordSettingsQueries {
  const homesIn = async (
    lookup: DiscordLookup,
    app: DiscordApplicationInfo,
    guildId: string,
    signal: AbortSignal,
  ): Promise<readonly HomeChannel[]> => {
    const guild = await lookup.guild(guildId, signal)
    const self = await lookup.member(guildId, app.bot.id, signal)
    if (guild === undefined || self === undefined) return []
    const channels = await lookup.channels(guildId, signal)
    return channels
      .filter(
        (channel) =>
          channel.text &&
          has(
            permissionsIn(guild, channel, { userId: app.bot.id, roles: self.roles }),
            HOME_PERMISSIONS,
          ),
      )
      .map((channel) => ({ guild, channel }))
  }

  const homeChannel = async (
    lookup: DiscordLookup,
    app: DiscordApplicationInfo,
    place: Extract<DiscordHomePlace, { readonly kind: "channel" }>,
    signal: AbortSignal,
  ): Promise<HomeChannel | undefined> =>
    (await homesIn(lookup, app, place.guildId, signal)).find(
      (home) => home.channel.id === place.channelId,
    )

  const homeOptions = async (
    lookup: DiscordLookup,
    signal: AbortSignal,
  ): Promise<BotChannelOptions> => {
    const app = await lookup.application(signal)
    const options: BotChannelOption[] = [
      {
        value: DM_HOME,
        label: SETTINGS_TEXTS.directMessages,
        detail: SETTINGS_TEXTS.directMessagesDetail,
        image: app.bot.avatarUrl,
      },
    ]
    for (const listed of await lookup.guilds(signal)) {
      for (const { guild, channel } of await homesIn(lookup, app, listed.id, signal)) {
        options.push({
          value: channelHomeValue(guild.id, channel.id),
          label: { en: `#${channel.name} (${guild.name})` },
          detail: SETTINGS_TEXTS.channelDetail,
          ...(guild.iconUrl === undefined ? {} : { image: guild.iconUrl }),
        })
      }
    }
    return { state: "ready", options, suggested: [DM_HOME] }
  }

  const withStored = async (
    lookup: DiscordLookup,
    options: BotChannelOptions,
    stored: readonly string[],
    signal: AbortSignal,
  ): Promise<BotChannelOptions> => {
    if (options.state !== "ready") return options
    const extra: BotChannelOption[] = []
    for (const id of stored) {
      if (options.options.some((option) => option.value === id)) continue
      const user = await lookup.user(id, signal)
      if (user !== undefined) extra.push(personOption(user, false))
    }
    return { ...options, options: [...options.options, ...extra] }
  }

  const ownerOptions = async (
    lookup: DiscordLookup,
    place: DiscordHomePlace,
    signal: AbortSignal,
  ): Promise<BotChannelOptions> => {
    const app = await lookup.application(signal)
    const appOwners = new Set(app.owners.map((user) => user.id))
    const suggested = app.owners.slice(0, 1).map((user) => user.id)
    if (place.kind === DM_HOME) {
      return {
        state: "ready",
        options: app.owners.map((user) => personOption(user, true)),
        suggested,
      }
    }
    if (!app.intents.members) return unavailable(SETTINGS_TEXTS.membersIntentOff)
    const home = await homeChannel(lookup, app, place, signal)
    if (home === undefined) return unavailable(SETTINGS_TEXTS.homeGone)
    const viewers = (await lookup.members(place.guildId, signal)).filter(
      (member) =>
        !member.user.bot &&
        has(
          permissionsIn(home.guild, home.channel, { userId: member.user.id, roles: member.roles }),
          PERMISSION.viewChannel,
        ),
    )
    const ordered = [
      ...viewers.filter((member) => appOwners.has(member.user.id)),
      ...viewers.filter((member) => !appOwners.has(member.user.id)),
    ]
    return {
      state: "ready",
      options: ordered.map((member) => personOption(member.user, appOwners.has(member.user.id))),
      suggested: suggested.filter((id) => ordered.some((member) => member.user.id === id)),
    }
  }

  const ownerProblem = async (
    lookup: DiscordLookup,
    home: HomeChannel,
    owner: string,
    signal: AbortSignal,
  ): Promise<BotChannelText | undefined> => {
    const member = await lookup.member(home.guild.id, owner, signal)
    if (member === undefined) {
      const user = await lookup.user(owner, signal)
      return settingsText("ownerNotMember", { who: user === undefined ? owner : named(user) })
    }
    const permissions = permissionsIn(home.guild, home.channel, {
      userId: owner,
      roles: member.roles,
    })
    return has(permissions, PERMISSION.viewChannel)
      ? undefined
      : settingsText("ownerOutside", { who: named(member.user) })
  }

  return {
    async options(request) {
      const { settings, signal, source } = request
      if (settings.token === "") return unavailable(SETTINGS_TEXTS.noToken)
      const lookup = open(settings.token)
      try {
        if (source === HOME_SOURCE) return await homeOptions(lookup, signal)
        if (source !== OWNERS_SOURCE) throw new Error(`Discord has no source "${source}"`)
        const place = homePlaceOf(settings.home)
        if (place === undefined) return unavailable(SETTINGS_TEXTS.noHome)
        return await withStored(
          lookup,
          await ownerOptions(lookup, place, signal),
          settings.approvers,
          signal,
        )
      } catch (error) {
        return unavailable(reasonOf(error))
      }
    },
    async check({ settings, signal }) {
      const place = homePlaceOf(settings.home)
      if (place === undefined) return { ok: false, reason: SETTINGS_TEXTS.noHome }
      if (place.kind === DM_HOME) {
        return settings.approvers.length === 1
          ? { ok: true }
          : { ok: false, reason: SETTINGS_TEXTS.oneOwner }
      }
      const lookup = open(settings.token)
      try {
        const app = await lookup.application(signal)
        const home = await homeChannel(lookup, app, place, signal)
        if (home === undefined) return { ok: false, reason: SETTINGS_TEXTS.homeGone }
        for (const owner of settings.approvers) {
          const problem = await ownerProblem(lookup, home, owner, signal)
          if (problem !== undefined) return { ok: false, reason: problem }
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: reasonOf(error) }
      }
    },
    async inspect({ settings, signal }) {
      if (settings.token === "") return unavailable(SETTINGS_TEXTS.noToken)
      try {
        const app = await open(settings.token).application(signal)
        const channelMode = homePlaceOf(settings.home)?.kind === "channel"
        const warnings: BotChannelText[] = channelMode
          ? [
              ...(app.intents.messageContent ? [] : [SETTINGS_TEXTS.messageContentOff]),
              ...(app.intents.members ? [] : [SETTINGS_TEXTS.membersOff]),
            ]
          : []
        return {
          state: "ready",
          account: app.bot.username,
          links: [
            { label: SETTINGS_TEXTS.invite, url: inviteUrl(app.id) },
            { label: SETTINGS_TEXTS.portal, url: portalUrl(app.id) },
          ],
          warnings,
        }
      } catch (error) {
        return unavailable(reasonOf(error))
      }
    },
  }
}
