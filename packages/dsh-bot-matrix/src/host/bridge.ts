import type {
  BotChannelConnection,
  BotChannelLink,
  BotChannelOutput,
  BotChannelPerson,
  BotInboundMessage,
  BotOutboundFile,
} from "@1outres/dsh-bot-core"
import { ensureAccount } from "./accounts"
import { createActionPresenter } from "./actions/presenter"
import { createCardPresenter } from "./cards/presenter"
import { catchUp } from "./catch-up"
import type { MatrixSettings } from "./fields"
import { createDirectChat, HomeMissing, homeOf, resolveHome } from "./home"
import { HomeserverRefusal, homeserverOf, TOKEN_REFUSED } from "./homeserver"
import { inNamespace } from "./ids"
import {
  commandOf,
  inboundMessageOf,
  type MatrixCommand,
  type MessageEvent,
  messageOf,
} from "./inbound"
import { createIncidentPresenter } from "./incidents"
import {
  isMatrixError,
  type MatrixApi,
  type MatrixEvent,
  type MatrixSync,
  type OpenMatrixApi,
} from "./matrix"
import { type Scheduler, sleep } from "./ports"
import { createProfilePresenter } from "./profile"
import { createSerialQueue } from "./queue"
import type { AccountRecords } from "./records/accounts"
import { adoptHomeRecords } from "./records/bots"
import { openActionRecords } from "./records/cards"
import type { CursorRecords } from "./records/cursors"
import type { MatrixTables } from "./records/domain"
import type { HomeRecords } from "./records/homes"
import { openIncidentRecords } from "./records/incidents"
import { createRoomPoster } from "./room"
import type { MatrixShared } from "./shared-fields"
import { BASE_RETRY_MS, MAX_RETRY_MS, runSyncLoop } from "./sync-loop"
import {
  commandText,
  deliveryFailureText,
  fill,
  HELP_HEAD,
  HELP_HELP,
  localeOf,
  PENDING_HELP,
  pickText,
  turnNotice,
} from "./texts"
import { createTypingKeeper, TYPING_TIMEOUT_MS } from "./typing"

export const ACCEPTED_REACTION = "👀"
export const FAILED_REACTION = "⚠️"
export const CHANNEL_ID = "matrix"
const RECENT = 200

export interface MatrixBridgeDeps {
  readonly link: BotChannelLink<MatrixSettings, MatrixShared>
  readonly open: OpenMatrixApi
  readonly tables: MatrixTables
  readonly accounts: AccountRecords
  readonly homes: HomeRecords
  readonly cursors: CursorRecords
  readonly scheduler: Scheduler
  warn(message: string): void
}

const messageText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const IMAGE_TYPES: readonly [string, readonly number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
]

export function imageTypeOf(data: Uint8Array): string | undefined {
  for (const [type, magic] of IMAGE_TYPES) {
    if (magic.every((byte, at) => data[at] === byte)) return type
  }
  const riff = [0x52, 0x49, 0x46, 0x46].every((byte, at) => data[at] === byte)
  const webp = [0x57, 0x45, 0x42, 0x50].every((byte, at) => data[at + 8] === byte)
  return riff && webp ? "image/webp" : undefined
}

interface Session {
  readonly api: MatrixApi
  readonly self: string
  roomId: string
  readonly uploadLimit: number | undefined
  readonly place: BotInboundMessage["place"]
}

export function createMatrixBridge(deps: MatrixBridgeDeps): BotChannelConnection {
  const { link } = deps
  const stop = new AbortController()
  const signal = AbortSignal.any([link.signal, stop.signal])
  const home = homeOf(link.settings)
  const owners: ReadonlySet<string> = new Set(link.settings.approvers)
  const locale = localeOf(link.settings.language)
  const homeserver = homeserverOf(deps.open, link.shared)
  const closed = () => signal.aborted
  const warn = (what: string) => (error: unknown) => {
    if (!closed()) deps.warn(`bot-matrix: ${what}: ${messageText(error)}`)
  }
  const outbound = createSerialQueue()
  const recent: string[] = []
  const names = new Map<string, string>()
  let ownerPresent = true

  let resolveSession: (session: Session) => void = () => {}
  let rejectSession: (error: unknown) => void = () => {}
  const ready = new Promise<Session>((resolve, reject) => {
    resolveSession = resolve
    rejectSession = reject
  })
  ready.catch(() => undefined)
  const roomId = async () => (await ready).roomId
  const poster = createRoomPoster(() => ready, signal)
  const actionRecords = openActionRecords(deps.tables, link.bot.id)
  const cards = createCardPresenter({
    link,
    poster,
    owners,
    anyoneAnswersQuestions: home.kind === "room",
    self: CHANNEL_ID,
    locale,
    outbound,
    closed,
    warn: deps.warn,
  })
  let actions: ReturnType<typeof createActionPresenter> | undefined
  const incidents = createIncidentPresenter({
    bot: link.bot,
    poster,
    records: openIncidentRecords(deps.tables, link.bot.id),
    roomId,
    locale,
    outbound,
    closed,
  })
  let profile: ReturnType<typeof createProfilePresenter> | undefined
  const pendingProfiles: Parameters<ReturnType<typeof createProfilePresenter>["received"]>[0][] = []
  const typing = createTypingKeeper({
    show: async (on, current) => {
      if (closed() || !current()) return
      const session = await ready
      await session.api.typing(session.roomId, on, TYPING_TIMEOUT_MS, signal)
    },
    scheduler: deps.scheduler,
    warn: deps.warn,
  })

  const nameOf = async (api: MatrixApi, userId: string) => {
    const known = names.get(userId)
    if (known !== undefined) return known
    const profile = await api.profile(userId, signal).catch(() => undefined)
    const name = profile?.displayName ?? userId
    names.set(userId, name)
    return name
  }

  const people = async (api: MatrixApi): Promise<Record<string, BotChannelPerson>> => {
    const found: Record<string, BotChannelPerson> = {}
    for (const owner of owners)
      found[owner] = { displayName: await nameOf(api, owner), handle: owner }
    return found
  }

  const sendFile = async (file: BotOutboundFile) => {
    const session = await ready
    if (session.uploadLimit !== undefined && file.data.byteLength > session.uploadLimit) {
      throw new Error(
        `the file is larger than the homeserver's upload limit of ${Math.floor(session.uploadLimit / 1024 / 1024)} MiB`,
      )
    }
    const image = imageTypeOf(file.data)
    const contentType = image ?? "application/octet-stream"
    await outbound.push(async () => {
      const url = await session.api.upload(file.data, contentType, file.name, signal)
      await poster.file({
        msgtype: image === undefined ? "m.file" : "m.image",
        body: file.caption ?? file.name,
        filename: file.name,
        url,
        info: { mimetype: contentType, size: file.data.byteLength },
      })
    })
    typing.pulse()
  }

  const receive = async (output: BotChannelOutput): Promise<void> => {
    if (closed()) throw new Error("the Matrix connection is closing")
    switch (output.kind) {
      case "reply":
        await outbound.push(async () => {
          await poster.text(output.reply.text)
        })
        typing.pulse()
        return
      case "file":
        return sendFile(output.file)
      case "turn": {
        if (output.turn.phase === "started") {
          typing.start()
          return
        }
        typing.stop()
        const notice = turnNotice(output.turn, locale)
        if (notice !== undefined)
          await outbound.push(async () => void (await poster.notice(notice)))
        return
      }
      case "interaction-opened":
        return cards.opened(output.interaction)
      case "interaction-updated":
        return cards.updated(output.interaction)
      case "interaction-closed":
        return cards.closed(output.closure)
      case "connector-action":
        await ready
        return actions?.received(output.action)
      case "credential-incident":
        return incidents.received(output.incident)
      case "profile":
        if (profile === undefined) pendingProfiles.push(output.profile)
        else profile.received(output.profile)
        return
      case "sender-inquiry":
        throw new Error("the Matrix channel does not take sender inquiries")
    }
  }

  const help = () =>
    [
      fill(HELP_HEAD, locale),
      ...link.commands.map(
        (command) => `- \`!${command.id}\` — ${pickText(command.description, locale)}`,
      ),
      `- \`!pending\` — ${fill(PENDING_HELP, locale)}`,
      `- \`!help\` — ${fill(HELP_HELP, locale)}`,
    ].join("\n")

  const runCommand = async (command: MatrixCommand, sender: string, eventId: string) => {
    let text: string
    if (command === "help") text = help()
    else if (command === "pending") text = actions?.pending(sender) ?? ""
    else {
      const spec = link.commands.find((listed) => listed.id === command)
      if (spec === undefined) return
      text = commandText(await link.run(spec.id, sender), locale)
    }
    await outbound.push(async () => void (await poster.notice(text, eventId)))
  }

  const deliver = async (session: Session, message: MessageEvent) => {
    const { event } = message
    const sender = { userId: event.sender, displayName: await nameOf(session.api, event.sender) }
    const result = await link.deliver(inboundMessageOf(message, sender, session.place, session.api))
    if (closed()) return
    if (!result.delivered) {
      deps.warn(
        `bot-matrix: a message of bot "${link.bot.name}" was not delivered: ${result.failure.message}`,
      )
    }
    await poster
      .react(event.eventId, result.delivered ? ACCEPTED_REACTION : FAILED_REACTION)
      .catch(warn("could not react to a message"))
    if (!result.delivered) {
      await outbound.push(async () => {
        await poster
          .notice(deliveryFailureText(result.failure, locale), event.eventId)
          .catch(warn("could not say why a message was not delivered"))
      })
    } else {
      await session.api
        .receipt(session.roomId, event.eventId, signal)
        .catch(warn("could not mark a message read"))
    }
  }

  const fromSomeoneElse = (session: Session, sender: string) =>
    sender !== session.self && !inNamespace(sender, homeserver.prefix)

  const handleEvent = async (session: Session, event: MatrixEvent) => {
    if (event.type === "m.room.member" && home.kind === "dm" && event.stateKey === home.owner) {
      const membership = event.content.membership
      ownerPresent = membership === "join" || membership === "invite"
      if (membership === "leave" || membership === "ban") {
        session.roomId = await createDirectChat(
          session.api,
          deps.homes,
          link.bot.id,
          home.owner,
          signal,
        )
        ownerPresent = true
      }
      return
    }
    if (!fromSomeoneElse(session, event.sender)) return
    if (event.type === "m.reaction") {
      const relates = event.content["m.relates_to"] as Record<string, unknown> | undefined
      if (
        relates?.rel_type !== "m.annotation" ||
        typeof relates.event_id !== "string" ||
        typeof relates.key !== "string"
      )
        return
      if (!cards.react(relates.event_id, relates.key, event.sender))
        actions?.react(relates.event_id, relates.key, event.sender)
      return
    }
    const message = messageOf(event)
    if (message === undefined) return
    if (home.kind === "dm" && event.sender !== home.owner) return
    if (
      message.replyTo !== undefined &&
      cards.reply(message.replyTo, message.text, event.sender, event.eventId)
    )
      return
    const command = message.media === undefined ? commandOf(message.text) : undefined
    if (command !== undefined) {
      await runCommand(command, event.sender, event.eventId)
      return
    }
    if (message.text.trim() === "" && message.media === undefined) return
    await deliver(session, message)
  }

  const seen = (eventId: string) => {
    if (recent.includes(eventId)) return true
    recent.push(eventId)
    if (recent.length > RECENT) recent.shift()
    return false
  }

  const joinInvites = async (session: Session, sync: MatrixSync) => {
    if (home.kind !== "dm" || ownerPresent) return
    for (const [invited, states] of sync.invited) {
      const own = states.find(
        (state) => state.type === "m.room.member" && state.stateKey === session.self,
      )
      if (own?.sender !== home.owner || own.content.is_direct !== true) continue
      await session.api.join(invited, signal)
      await deps.homes.save(link.bot.id, home.owner, invited)
      session.roomId = invited
      ownerPresent = true
      return
    }
  }

  const handleSync = async (session: Session, sync: MatrixSync, initial: boolean) => {
    await joinInvites(session, sync)
    const room = sync.joined.get(session.roomId)
    if (room === undefined || initial) return
    let events = room.timeline
    const cursor = deps.cursors.get(link.bot.id)
    const last = cursor?.roomId === session.roomId ? cursor.lastEventId : undefined
    if (room.limited && room.prevBatch !== undefined && last !== undefined) {
      const caught = await catchUp(session.api, session.roomId, room.prevBatch, last, signal)
      if (!caught.complete) {
        deps.warn(
          `bot-matrix: more messages than can be caught up were sent to bot "${link.bot.name}" while it was away; the oldest are not delivered`,
        )
      }
      events = [...caught.events, ...events]
    }
    let lastEventId = last
    for (const event of events) {
      if (closed()) return
      if (event.eventId === last || seen(event.eventId)) continue
      await handleEvent(session, event).catch(warn("could not take an event"))
      lastEventId = event.eventId
    }
    lastHandled = lastEventId
  }
  let lastHandled: string | undefined

  const connect = async (): Promise<Session> => {
    let delay = BASE_RETRY_MS
    for (;;) {
      link.report({ state: "connecting" })
      try {
        const account = await ensureAccount(homeserver, deps.accounts, link.bot, signal)
        const uploadLimit = await account.api.uploadLimit(signal).catch(() => undefined)
        const room = await resolveHome(account.api, deps.homes, link.bot.id, home, signal)
        await adoptHomeRecords(deps.tables, link.bot.id, room)
        const name =
          home.kind === "room"
            ? await account.api.state(room, "m.room.name", "", signal).catch(() => undefined)
            : undefined
        return {
          api: account.api,
          self: account.userId,
          roomId: room,
          uploadLimit,
          place:
            home.kind === "dm"
              ? { kind: "direct" }
              : {
                  kind: "channel",
                  channel: typeof name?.name === "string" ? name.name : room,
                  server: account.serverName,
                },
        }
      } catch (error) {
        if (signal.aborted) throw error
        if (error instanceof HomeserverRefusal) throw new Error(error.reason.en)
        if (isMatrixError(error, "token")) throw new Error(TOKEN_REFUSED.en)
        if (error instanceof HomeMissing) throw error
        link.report({ state: "failed", message: messageText(error) })
        await sleep(deps.scheduler, delay, signal)
        delay = Math.min(delay * 2, MAX_RETRY_MS)
      }
    }
  }

  const start = async () => {
    const session = await connect()
    actions = createActionPresenter({
      link,
      api: session.api,
      poster,
      records: actionRecords,
      roomId,
      self: CHANNEL_ID,
      locale,
      outbound,
      signal,
      closed,
      warn: deps.warn,
    })
    profile = createProfilePresenter({
      link,
      api: session.api,
      accounts: deps.accounts,
      signal,
      closed,
      warn: deps.warn,
    })
    const cursor = deps.cursors.get(link.bot.id)
    lastHandled = cursor?.roomId === session.roomId ? cursor.lastEventId : undefined
    resolveSession(session)
    profile.ready()
    for (const queued of pendingProfiles.splice(0)) profile.received(queued)
    actions.start().catch(warn("could not bring the connector action messages up to date"))
    if (link.activity() === "running") typing.start()
    const named = await people(session.api)
    await runSyncLoop({
      api: session.api,
      scheduler: deps.scheduler,
      signal,
      since: () => deps.cursors.get(link.bot.id)?.since,
      handle: (sync, initial) => handleSync(session, sync, initial),
      saved: (nextBatch) =>
        deps.cursors.save(link.bot.id, {
          since: nextBatch,
          roomId: session.roomId,
          ...(lastHandled === undefined ? {} : { lastEventId: lastHandled }),
        }),
      healthy: () => link.report({ state: "connected", account: session.self, people: named }),
      unhealthy: (message) => link.report({ state: "failed", message }),
      refused: () => link.report({ state: "failed", message: TOKEN_REFUSED.en }),
      warn: deps.warn,
    })
  }

  start().catch((error: unknown) => {
    rejectSession(error)
    if (!closed()) link.report({ state: "failed", message: messageText(error) })
  })

  return {
    receive,
    async close() {
      if (stop.signal.aborted) return
      typing.stop()
      stop.abort()
      await outbound.idle()
    },
  }
}
