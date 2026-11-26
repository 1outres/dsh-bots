import type { DiscordGatewayMode } from "./discord"

export const DM_HOME = "dm"

export type DiscordHome =
  | { readonly kind: "dm"; readonly owner: string }
  | { readonly kind: "channel"; readonly guildId: string; readonly channelId: string }

export type DiscordHomePlace =
  | { readonly kind: "dm" }
  | { readonly kind: "channel"; readonly guildId: string; readonly channelId: string }

const CHANNEL_HOME = /^([0-9]{17,20}):([0-9]{17,20})$/

export function homePlaceOf(value: string): DiscordHomePlace | undefined {
  if (value === DM_HOME) return { kind: "dm" }
  const match = CHANNEL_HOME.exec(value)
  if (match === null) return undefined
  return { kind: "channel", guildId: match[1] as string, channelId: match[2] as string }
}

export const channelHomeValue = (guildId: string, channelId: string) => `${guildId}:${channelId}`

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

export interface DiscordPlace {
  readonly userId: string
  readonly guildId: string | null
  readonly channelId: string
}

export function atHome(home: DiscordHome, place: DiscordPlace): boolean {
  return home.kind === "dm"
    ? place.guildId === null && place.userId === home.owner
    : place.guildId === home.guildId && place.channelId === home.channelId
}
