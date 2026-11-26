import type { DiscordChannelInfo, DiscordGuildInfo } from "./discord"

export const PERMISSION = {
  administrator: 1n << 3n,
  addReactions: 1n << 6n,
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  embedLinks: 1n << 14n,
  attachFiles: 1n << 15n,
  readMessageHistory: 1n << 16n,
  pinMessages: 1n << 51n,
} as const

const ALL = (1n << 64n) - 1n

export const HOME_PERMISSIONS =
  PERMISSION.viewChannel | PERMISSION.sendMessages | PERMISSION.readMessageHistory

export const INVITE_PERMISSIONS =
  HOME_PERMISSIONS |
  PERMISSION.embedLinks |
  PERMISSION.attachFiles |
  PERMISSION.addReactions |
  PERMISSION.pinMessages

export function permissionsIn(
  guild: DiscordGuildInfo,
  channel: DiscordChannelInfo,
  member: { readonly userId: string; readonly roles: readonly string[] },
): bigint {
  if (member.userId === guild.ownerId) return ALL
  const roles = new Set(member.roles)
  let base = 0n
  for (const role of guild.roles) {
    if (role.id === guild.id || roles.has(role.id)) base |= role.permissions
  }
  if ((base & PERMISSION.administrator) !== 0n) return ALL
  let permissions = base
  const everyone = channel.overwrites.find((overwrite) => overwrite.id === guild.id)
  if (everyone !== undefined) permissions = (permissions & ~everyone.deny) | everyone.allow
  let allow = 0n
  let deny = 0n
  for (const overwrite of channel.overwrites) {
    if (overwrite.kind === "role" && overwrite.id !== guild.id && roles.has(overwrite.id)) {
      allow |= overwrite.allow
      deny |= overwrite.deny
    }
  }
  permissions = (permissions & ~deny) | allow
  const own = channel.overwrites.find(
    (overwrite) => overwrite.kind === "member" && overwrite.id === member.userId,
  )
  if (own !== undefined) permissions = (permissions & ~own.deny) | own.allow
  return permissions
}

export const has = (permissions: bigint, wanted: bigint) => (permissions & wanted) === wanted
