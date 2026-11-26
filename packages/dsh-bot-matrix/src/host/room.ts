import { matrixText } from "./format/markdown"
import { splitMarkdown } from "./format/split"
import type { MatrixApi } from "./matrix"

export interface RoomPoster {
  text(markdown: string, replyTo?: string): Promise<string>
  notice(markdown: string, replyTo?: string): Promise<string>
  edit(eventId: string, markdown: string): Promise<void>
  react(eventId: string, key: string): Promise<string>
  redact(eventId: string): Promise<void>
  file(content: Readonly<Record<string, unknown>>): Promise<string>
}

const NO_MENTIONS = { "m.mentions": {} }

const replyOf = (replyTo: string | undefined) =>
  replyTo === undefined ? {} : { "m.relates_to": { "m.in_reply_to": { event_id: replyTo } } }

export interface RoomTarget {
  readonly api: MatrixApi
  readonly roomId: string
}

export function createRoomPoster(
  target: () => Promise<RoomTarget>,
  signal: AbortSignal,
): RoomPoster {
  const send = async (msgtype: string, markdown: string, replyTo: string | undefined) => {
    const { api, roomId: room } = await target()
    let last = ""
    for (const [index, chunk] of splitMarkdown(markdown).entries()) {
      last = await api.send(
        room,
        "m.room.message",
        { msgtype, ...matrixText(chunk), ...NO_MENTIONS, ...(index === 0 ? replyOf(replyTo) : {}) },
        signal,
      )
    }
    return last
  }
  return {
    text: (markdown, replyTo) => send("m.text", markdown, replyTo),
    notice: (markdown, replyTo) => send("m.notice", markdown, replyTo),
    async edit(eventId, markdown) {
      const { api, roomId: room } = await target()
      const content = { msgtype: "m.text", ...matrixText(markdown), ...NO_MENTIONS }
      await api.send(
        room,
        "m.room.message",
        {
          msgtype: "m.text",
          body: `* ${content.body}`,
          "m.new_content": content,
          "m.relates_to": { rel_type: "m.replace", event_id: eventId },
          ...NO_MENTIONS,
        },
        signal,
      )
    },
    async react(eventId, key) {
      const { api, roomId: room } = await target()
      return api.send(
        room,
        "m.reaction",
        { "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key } },
        signal,
      )
    },
    async redact(eventId) {
      const { api, roomId: room } = await target()
      await api.redact(room, eventId, signal)
    },
    async file(content) {
      const { api, roomId: room } = await target()
      return api.send(room, "m.room.message", { ...content, ...NO_MENTIONS }, signal)
    },
  }
}
