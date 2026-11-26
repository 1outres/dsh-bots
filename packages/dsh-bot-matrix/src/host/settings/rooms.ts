import { serverNameOf } from "../ids"
import type { MatrixApi, MatrixStrippedState } from "../matrix"

export interface RoomFacts {
  readonly roomId: string
  readonly membership: "join" | "invite"
  readonly name: string
  readonly avatarUrl?: string
  readonly encrypted: boolean
  readonly members: number
  readonly inviter?: string
  readonly canPin: boolean
  readonly federated: boolean
  readonly direct: boolean
}

const stateOf = (states: readonly MatrixStrippedState[], type: string) =>
  states.find((state) => state.type === type)?.content

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined)

export function canSend(
  power: Readonly<Record<string, unknown>> | undefined,
  userId: string,
  type: string,
): boolean {
  if (power === undefined) return true
  const users = (power.users ?? {}) as Record<string, unknown>
  const events = (power.events ?? {}) as Record<string, unknown>
  const level =
    typeof users[userId] === "number"
      ? (users[userId] as number)
      : typeof power.users_default === "number"
        ? power.users_default
        : 0
  const needed =
    typeof events[type] === "number"
      ? (events[type] as number)
      : typeof power.state_default === "number"
        ? power.state_default
        : 50
  return level >= needed
}

export async function roomFacts(
  api: MatrixApi,
  userId: string,
  signal: AbortSignal,
): Promise<readonly RoomFacts[]> {
  const sync = await api.sync({
    timeoutMs: 0,
    filter: {
      room: { timeline: { limit: 0 }, state: { lazy_load_members: true } },
      presence: { not_types: ["*"] },
      account_data: { not_types: ["*"] },
    },
    signal,
  })
  const rooms: RoomFacts[] = []
  const own = serverNameOf(userId)
  for (const roomId of await api.joinedRooms(signal)) {
    const [name, avatar, encryption, power, members] = await Promise.all([
      api.state(roomId, "m.room.name", "", signal).catch(() => undefined),
      api.state(roomId, "m.room.avatar", "", signal).catch(() => undefined),
      api.state(roomId, "m.room.encryption", "", signal).catch(() => undefined),
      api.state(roomId, "m.room.power_levels", "", signal).catch(() => undefined),
      api.members(roomId, signal).catch(() => []),
    ])
    const present = members.filter(
      (member) => member.membership === "join" || member.membership === "invite",
    )
    const others = present.filter((member) => member.userId !== userId)
    const self = members.find((member) => member.userId === userId)
    rooms.push({
      roomId,
      membership: "join",
      name:
        text(name?.name) ??
        others
          .map((member) => member.displayName ?? member.userId)
          .slice(0, 3)
          .join(", ") ??
        roomId,
      ...(text(avatar?.url) === undefined ? {} : { avatarUrl: text(avatar?.url) }),
      encrypted: encryption !== undefined,
      members: present.length,
      canPin: canSend(power, userId, "m.room.pinned_events"),
      federated: present.some((member) => serverNameOf(member.userId) !== own),
      direct: self !== undefined && present.length <= 2,
    })
  }
  for (const [roomId, states] of sync.invited) {
    const membership = states.find(
      (state) => state.type === "m.room.member" && state.stateKey === userId,
    )
    rooms.push({
      roomId,
      membership: "invite",
      name: text(stateOf(states, "m.room.name")?.name) ?? membership?.sender ?? roomId,
      ...(text(stateOf(states, "m.room.avatar")?.url) === undefined
        ? {}
        : { avatarUrl: text(stateOf(states, "m.room.avatar")?.url) }),
      encrypted: stateOf(states, "m.room.encryption") !== undefined,
      members: states.filter((state) => state.type === "m.room.member").length,
      ...(membership === undefined ? {} : { inviter: membership.sender }),
      canPin: true,
      federated: false,
      direct: membership?.content.is_direct === true,
    })
  }
  return rooms.map((room) => (room.name === "" ? { ...room, name: room.roomId } : room))
}
