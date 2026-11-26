import { DM_HOME } from "./fields"
import { isMatrixError, type MatrixApi } from "./matrix"
import type { HomeRecords } from "./records/homes"

export type MatrixHome =
  | { readonly kind: "dm"; readonly owner: string }
  | { readonly kind: "room"; readonly roomId: string }

export function homeOf(settings: {
  readonly home: string
  readonly approvers: readonly string[]
}): MatrixHome {
  if (settings.home !== DM_HOME) return { kind: "room", roomId: settings.home }
  const [owner, ...others] = settings.approvers
  if (owner === undefined || others.length > 0) {
    throw new Error("a home in a direct chat needs exactly one owner")
  }
  return { kind: "dm", owner }
}

export class HomeMissing extends Error {
  override readonly name = "HomeMissing"
}

const present = (membership: string | undefined) => membership === "join" || membership === "invite"

export async function createDirectChat(
  api: MatrixApi,
  homes: HomeRecords,
  botId: string,
  owner: string,
  signal: AbortSignal,
): Promise<string> {
  const roomId = await api.createRoom(
    { preset: "trusted_private_chat", isDirect: true, invite: [owner] },
    signal,
  )
  const direct = (await api.accountData("m.direct", signal)) ?? {}
  const listed = Array.isArray(direct[owner])
    ? (direct[owner] as unknown[]).filter((id) => typeof id === "string")
    : []
  await api.setAccountData("m.direct", { ...direct, [owner]: [...listed, roomId] }, signal)
  await homes.save(botId, owner, roomId)
  return roomId
}

export async function resolveHome(
  api: MatrixApi,
  homes: HomeRecords,
  botId: string,
  home: MatrixHome,
  signal: AbortSignal,
): Promise<string> {
  const joined = new Set(await api.joinedRooms(signal))
  if (home.kind === "room") {
    if (joined.has(home.roomId)) return home.roomId
    try {
      await api.join(home.roomId, signal)
      return home.roomId
    } catch (error) {
      if (isMatrixError(error, "forbidden") || isMatrixError(error, "not-found")) {
        throw new HomeMissing("The bot is not in this room: invite it, then turn Matrix on again.")
      }
      throw error
    }
  }
  const known = homes.get(botId)
  if (known !== undefined && known.owner === home.owner) {
    if (!joined.has(known.roomId)) {
      await api.join(known.roomId, signal).catch(() => undefined)
    }
    const members = await api.members(known.roomId, signal).catch(() => [])
    const owner = members.find((member) => member.userId === home.owner)
    if (present(owner?.membership) && new Set(await api.joinedRooms(signal)).has(known.roomId)) {
      return known.roomId
    }
  }
  return createDirectChat(api, homes, botId, home.owner, signal)
}
