export const MXID_PATTERN = "@[a-z0-9._=/+-]+:[A-Za-z0-9.-]+(:[0-9]{1,5})?"
export const PREFIX_PATTERN = "[a-z0-9._=-]{1,32}"
export const ROOM_ID_PATTERN = "![A-Za-z0-9._~+/=:-]{1,254}"

const MXID = new RegExp(`^${MXID_PATTERN}$`)

export const isMxid = (value: string): boolean => MXID.test(value)

export function serverNameOf(userId: string): string {
  const at = userId.indexOf(":")
  if (!userId.startsWith("@") || at < 0) throw new Error(`"${userId}" is not a Matrix user id`)
  return userId.slice(at + 1)
}

export function localpartOf(userId: string): string {
  const at = userId.indexOf(":")
  if (!userId.startsWith("@") || at < 0) throw new Error(`"${userId}" is not a Matrix user id`)
  return userId.slice(1, at)
}

export const botLocalpart = (prefix: string, botId: string): string =>
  `${prefix}_${botId.toLowerCase().replace(/[^a-z0-9._=-]/g, "-")}`

export const botUserId = (prefix: string, botId: string, serverName: string): string =>
  `@${botLocalpart(prefix, botId)}:${serverName}`

export function inNamespace(userId: string, prefix: string): boolean {
  const local = localpartOf(userId)
  return local === prefix || local.startsWith(`${prefix}_`)
}

export const matrixTo = (roomId: string, eventId?: string): string =>
  `https://matrix.to/#/${encodeURIComponent(roomId)}${eventId === undefined ? "" : `/${encodeURIComponent(eventId)}`}`
