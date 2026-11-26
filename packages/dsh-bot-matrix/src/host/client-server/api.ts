import {
  type MatrixApi,
  MatrixError,
  type MatrixEvent,
  type MatrixJoinedRoom,
  type MatrixMember,
  type MatrixStrippedState,
  type MatrixSync,
} from "../matrix"
import type { Scheduler } from "../ports"
import {
  type HttpDeps,
  type HttpRequest,
  type MatrixFetch,
  readLimited,
  request,
  requestJson,
} from "./http"
import {
  eventIdSchema,
  eventSchema,
  joinedRoomsSchema,
  mediaConfigSchema,
  membersSchema,
  messagesSchema,
  objectSchema,
  profileSchema,
  roomIdSchema,
  strippedStateSchema,
  syncSchema,
  uploadSchema,
  versionsSchema,
  whoamiSchema,
} from "./schemas"

export interface MatrixApiDeps {
  readonly fetch: MatrixFetch
  readonly scheduler: Scheduler
  newId(): string
}

const CLIENT = "/_matrix/client/v3"
const enc = encodeURIComponent

function parsed<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
  what: string,
): T {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new MatrixError("rejected", `the homeserver sent an unexpected ${what}`)
  return result.data
}

function eventsOf(values: readonly unknown[]): MatrixEvent[] {
  return values.flatMap((value) => {
    const result = eventSchema.safeParse(value)
    if (!result.success) return []
    const event = result.data
    return [
      {
        eventId: event.event_id,
        type: event.type,
        sender: event.sender,
        originServerTs: event.origin_server_ts,
        content: event.content,
        ...(event.state_key === undefined ? {} : { stateKey: event.state_key }),
        ...(event.redacts === undefined ? {} : { redacts: event.redacts }),
      },
    ]
  })
}

function strippedOf(values: readonly unknown[]): MatrixStrippedState[] {
  return values.flatMap((value) => {
    const result = strippedStateSchema.safeParse(value)
    return result.success
      ? [
          {
            type: result.data.type,
            sender: result.data.sender,
            stateKey: result.data.state_key,
            content: result.data.content,
          },
        ]
      : []
  })
}

const MEMBERSHIPS = new Set(["join", "invite", "leave", "ban", "knock"])

function memberOf(event: MatrixEvent): MatrixMember | undefined {
  const membership = event.content.membership
  if (event.type !== "m.room.member" || event.stateKey === undefined) return undefined
  if (typeof membership !== "string" || !MEMBERSHIPS.has(membership)) return undefined
  const { displayname, avatar_url } = event.content
  return {
    userId: event.stateKey,
    membership: membership as MatrixMember["membership"],
    ...(typeof displayname === "string" ? { displayName: displayname } : {}),
    ...(typeof avatar_url === "string" ? { avatarUrl: avatar_url } : {}),
  }
}

export function mediaPathOf(mxc: string): string {
  const match = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(mxc)
  if (match === null) throw new MatrixError("rejected", `"${mxc}" is not a Matrix media address`)
  return `${enc(match[1] as string)}/${enc(match[2] as string)}`
}

export function createMatrixApi(
  deps: MatrixApiDeps,
  homeserver: string,
  asToken: string,
  user?: string,
): MatrixApi {
  const http: HttpDeps = { fetch: deps.fetch, scheduler: deps.scheduler, homeserver, asToken }
  const call = (spec: Omit<HttpRequest, "user">) =>
    requestJson(http, { ...spec, ...(user === undefined ? {} : { user }) })
  const raw = (spec: Omit<HttpRequest, "user">) =>
    request(http, { ...spec, ...(user === undefined ? {} : { user }) })
  const self = () => {
    if (user === undefined) throw new Error("this request needs a bot's Matrix user")
    return user
  }
  const room = (roomId: string) => `${CLIENT}/rooms/${enc(roomId)}`

  return {
    user,
    as: (userId) => createMatrixApi(deps, homeserver, asToken, userId),
    async unauthenticated(path, signal) {
      try {
        return await requestJson(http, { method: "GET", path, authenticated: false, signal })
      } catch (error) {
        if (error instanceof MatrixError) return undefined
        throw error
      }
    },
    async versions(signal) {
      const body = await requestJson(http, {
        method: "GET",
        path: "/_matrix/client/versions",
        authenticated: false,
        signal,
      })
      return parsed(versionsSchema, body, "list of versions").versions
    },
    async whoami(signal) {
      return parsed(
        whoamiSchema,
        await call({ method: "GET", path: `${CLIENT}/account/whoami`, signal }),
        "identity",
      ).user_id
    },
    async register(localpart, signal) {
      try {
        await requestJson(http, {
          method: "POST",
          path: `${CLIENT}/register`,
          json: { type: "m.login.application_service", username: localpart, inhibit_login: true },
          signal,
        })
        return "created"
      } catch (error) {
        if (error instanceof MatrixError && error.kind === "user-in-use") return "exists"
        throw error
      }
    },
    async deactivate(signal) {
      self()
      await call({
        method: "POST",
        path: `${CLIENT}/account/deactivate`,
        json: { erase: false },
        signal,
      })
    },
    async uploadLimit(signal) {
      const body = await call({ method: "GET", path: "/_matrix/client/v1/media/config", signal })
      return parsed(mediaConfigSchema, body, "media configuration")["m.upload.size"]
    },
    async sync(requested) {
      const query: Record<string, string> = {
        timeout: String(requested.timeoutMs),
        filter: JSON.stringify(requested.filter),
      }
      if (requested.since !== undefined) query.since = requested.since
      let body: unknown
      try {
        body = await call({
          method: "GET",
          path: `${CLIENT}/sync`,
          query,
          signal: requested.signal,
        })
      } catch (error) {
        if (requested.since !== undefined && error instanceof MatrixError && error.status === 400) {
          throw new MatrixError("bad-since", error.message, 400, error.errcode)
        }
        throw error
      }
      const sync = parsed(syncSchema, body, "sync")
      const joined = new Map<string, MatrixJoinedRoom>()
      for (const [roomId, joinedRoom] of Object.entries(sync.rooms.join)) {
        joined.set(roomId, {
          timeline: eventsOf(joinedRoom.timeline.events),
          limited: joinedRoom.timeline.limited === true,
          ...(joinedRoom.timeline.prev_batch === undefined
            ? {}
            : { prevBatch: joinedRoom.timeline.prev_batch }),
          state: eventsOf(joinedRoom.state.events),
        })
      }
      const invited = new Map<string, readonly MatrixStrippedState[]>()
      for (const [roomId, invite] of Object.entries(sync.rooms.invite)) {
        invited.set(roomId, strippedOf(invite.invite_state.events))
      }
      const result: MatrixSync = {
        nextBatch: sync.next_batch,
        joined,
        invited,
        left: new Set(Object.keys(sync.rooms.leave)),
      }
      return result
    },
    async messages(roomId, from, limit, signal) {
      const body = await call({
        method: "GET",
        path: `${room(roomId)}/messages`,
        query: { from, dir: "b", limit: String(limit) },
        signal,
      })
      const page = parsed(messagesSchema, body, "page of messages")
      return { chunk: eventsOf(page.chunk), ...(page.end === undefined ? {} : { end: page.end }) }
    },
    async send(roomId, type, content, signal) {
      const body = await call({
        method: "PUT",
        path: `${room(roomId)}/send/${enc(type)}/${enc(deps.newId())}`,
        json: content,
        signal,
      })
      return parsed(eventIdSchema, body, "event id").event_id
    },
    async redact(roomId, eventId, signal) {
      await call({
        method: "PUT",
        path: `${room(roomId)}/redact/${enc(eventId)}/${enc(deps.newId())}`,
        json: {},
        signal,
      })
    },
    async typing(roomId, typing, timeoutMs, signal) {
      await call({
        method: "PUT",
        path: `${room(roomId)}/typing/${enc(self())}`,
        json: typing ? { typing: true, timeout: timeoutMs } : { typing: false },
        signal,
      })
    },
    async receipt(roomId, eventId, signal) {
      await call({
        method: "POST",
        path: `${room(roomId)}/receipt/m.read/${enc(eventId)}`,
        json: {},
        signal,
      })
    },
    async createRoom(spec, signal) {
      const body = await call({
        method: "POST",
        path: `${CLIENT}/createRoom`,
        json: {
          preset: spec.preset,
          is_direct: spec.isDirect,
          invite: spec.invite,
          ...(spec.name === undefined ? {} : { name: spec.name }),
        },
        signal,
      })
      return parsed(roomIdSchema, body, "room id").room_id
    },
    async join(roomId, signal) {
      await call({ method: "POST", path: `${CLIENT}/join/${enc(roomId)}`, json: {}, signal })
    },
    async leave(roomId, signal) {
      await call({ method: "POST", path: `${room(roomId)}/leave`, json: {}, signal })
    },
    async forget(roomId, signal) {
      await call({ method: "POST", path: `${room(roomId)}/forget`, json: {}, signal })
    },
    async joinedRooms(signal) {
      return parsed(
        joinedRoomsSchema,
        await call({ method: "GET", path: `${CLIENT}/joined_rooms`, signal }),
        "joined rooms",
      ).joined_rooms
    },
    async members(roomId, signal) {
      const body = await call({ method: "GET", path: `${room(roomId)}/members`, signal })
      return eventsOf(parsed(membersSchema, body, "members").chunk).flatMap((event) => {
        const member = memberOf(event)
        return member === undefined ? [] : [member]
      })
    },
    async state(roomId, type, stateKey, signal) {
      try {
        const body = await call({
          method: "GET",
          path: `${room(roomId)}/state/${enc(type)}/${enc(stateKey)}`,
          signal,
        })
        return parsed(objectSchema, body, "room state")
      } catch (error) {
        if (error instanceof MatrixError && error.kind === "not-found") return undefined
        throw error
      }
    },
    async putState(roomId, type, stateKey, content, signal) {
      await call({
        method: "PUT",
        path: `${room(roomId)}/state/${enc(type)}/${enc(stateKey)}`,
        json: content,
        signal,
      })
    },
    async profile(userId, signal) {
      try {
        const body = parsed(
          profileSchema,
          await call({ method: "GET", path: `${CLIENT}/profile/${enc(userId)}`, signal }),
          "profile",
        )
        return {
          ...(typeof body.displayname === "string" ? { displayName: body.displayname } : {}),
          ...(typeof body.avatar_url === "string" ? { avatarUrl: body.avatar_url } : {}),
        }
      } catch (error) {
        if (
          error instanceof MatrixError &&
          (error.kind === "not-found" || error.kind === "forbidden")
        )
          return undefined
        throw error
      }
    },
    async setDisplayName(name, signal) {
      await call({
        method: "PUT",
        path: `${CLIENT}/profile/${enc(self())}/displayname`,
        json: { displayname: name },
        signal,
      })
    },
    async setAvatarUrl(url, signal) {
      await call({
        method: "PUT",
        path: `${CLIENT}/profile/${enc(self())}/avatar_url`,
        json: { avatar_url: url },
        signal,
      })
    },
    async accountData(type, signal) {
      try {
        const body = await call({
          method: "GET",
          path: `${CLIENT}/user/${enc(self())}/account_data/${enc(type)}`,
          signal,
        })
        return parsed(objectSchema, body, "account data")
      } catch (error) {
        if (error instanceof MatrixError && error.kind === "not-found") return undefined
        throw error
      }
    },
    async setAccountData(type, content, signal) {
      await call({
        method: "PUT",
        path: `${CLIENT}/user/${enc(self())}/account_data/${enc(type)}`,
        json: content,
        signal,
      })
    },
    async upload(data, contentType, name, signal) {
      const body = await call({
        method: "POST",
        path: "/_matrix/media/v3/upload",
        query: { filename: name },
        bytes: { data, contentType },
        signal,
      })
      return parsed(uploadSchema, body, "upload").content_uri
    },
    async download(mxc, maxBytes, signal) {
      const response = await raw({
        method: "GET",
        path: `/_matrix/client/v1/media/download/${mediaPathOf(mxc)}`,
        signal,
      })
      return readLimited(response, maxBytes)
    },
    async thumbnail(mxc, size, signal) {
      try {
        const response = await raw({
          method: "GET",
          path: `/_matrix/client/v1/media/thumbnail/${mediaPathOf(mxc)}`,
          query: { width: String(size), height: String(size), method: "crop" },
          signal,
        })
        const contentType = response.headers.get("content-type") ?? ""
        return { data: await readLimited(response, 512 * 1024), contentType }
      } catch (error) {
        if (error instanceof MatrixError) return undefined
        throw error
      }
    },
  }
}
