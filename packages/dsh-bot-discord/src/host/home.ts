import type { DiscordGatewayMode } from "./discord"

/** The `home` value of direct messages. */
export const DM_HOME = "dm"

/** Where a bot lives in Discord: the DMs with its one owner, or one server text channel. */
export type DiscordHome =
  | { readonly kind: "dm"; readonly owner: string }
  | { readonly kind: "channel"; readonly guildId: string; readonly channelId: string }

/** Where the bot is, as the `home` setting names it, without the owner. */
export type DiscordHomePlace =
  | { readonly kind: "dm" }
  | { readonly kind: "channel"; readonly guildId: string; readonly channelId: string }

const CHANNEL_HOME = /^([0-9]{17,20}):([0-9]{17,20})$/

/** The place a `home` value names; undefined for "" or a malformed value. */
export function homePlaceOf(value: string): DiscordHomePlace | undefined {
  if (value === DM_HOME) return { kind: "dm" }
  const match = CHANNEL_HOME.exec(value)
  if (match === null) return undefined
  return { kind: "channel", guildId: match[1] as string, channelId: match[2] as string }
}

export const channelHomeValue = (guildId: string, channelId: string) => `${guildId}:${channelId}`

/**
 * The home of complete, checked settings.
 * @throws when `home` is malformed or a DM home lists other than one owner.
 */
export function homeOf(settings: {
  readonly home: string
  readonly approvers: readonly string[]
}): DiscordHome {
  const place = homePlaceOf(settings.home)
  if (place === undefined) throw new Error(`the home "${settings.home}" is not a Discord home`)
  if (place.kind === "channel") return place
  const [owner, ...others] = settings.approvers
  if (owner === undefined || others.length > 0) {
    throw new Error("a home in direct messages needs exactly one owner")
  }
  return { kind: "dm", owner }
}

export const gatewayModeOf = (home: DiscordHome): DiscordGatewayMode => home.kind

/** Who acted, and where, as the home is told apart. */
export interface DiscordPlace {
  readonly userId: string
  readonly guildId: string | null
  readonly channelId: string
}

/** Whether something happened at the home: in the owner's DMs, or in the home channel itself. */
export function atHome(home: DiscordHome, place: DiscordPlace): boolean {
  return home.kind === "dm"
    ? place.guildId === null && place.userId === home.owner
    : place.guildId === home.guildId && place.channelId === home.channelId
}
