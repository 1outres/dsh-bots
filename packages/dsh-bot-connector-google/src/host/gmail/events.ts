import type { BotConnectorEvents, ConnectorEvent, ConnectorJson } from "@1outres/dsh-bot-core"
import type { gmail_v1 } from "@googleapis/gmail"
import { type Google, googleStatus } from "../google"
import { oneLine } from "../kit"
import { METADATA_HEADERS, readMessage } from "./message"
import { senderOf } from "./sender"

export const MESSAGE_RECEIVED = "gmail.message.received"

const MAX_PAGES = 10
const MAX_MESSAGES = 200

interface Cursor {
  readonly historyId: string
}

const cursorOf = (value: ConnectorJson | undefined): Cursor | undefined => {
  const historyId = (value as { historyId?: unknown } | null | undefined)?.historyId
  return typeof historyId === "string" ? { historyId } : undefined
}

async function profileCursor(gmail: gmail_v1.Gmail): Promise<Cursor> {
  const profile = await gmail.users.getProfile({ userId: "me" })
  const historyId = profile.data.historyId
  if (!historyId) throw new Error("Gmail returned no historyId")
  return { historyId }
}

export function gmailEvents(google: Google): BotConnectorEvents {
  return {
    kinds: [
      {
        kind: MESSAGE_RECEIVED,
        label: { en: "New email in the inbox", ja: "受信トレイへの新着メール" },
      },
    ],
    delivery: "notify",
    intervalMs: 60_000,
    poll: (source, value) =>
      google.as(source.connection, async ({ gmail }) => {
        const cursor = cursorOf(value)
        if (cursor === undefined) return { events: [], cursor: { ...(await profileCursor(gmail)) } }
        const added = new Map<string, string>()
        let latest = cursor.historyId
        let pageToken: string | undefined
        try {
          for (let page = 0; page < MAX_PAGES; page += 1) {
            const response = await gmail.users.history.list({
              userId: "me",
              startHistoryId: cursor.historyId,
              historyTypes: ["messageAdded"],
              labelId: "INBOX",
              ...(pageToken === undefined ? {} : { pageToken }),
            })
            const entries = response.data.history ?? []
            for (const entry of entries) {
              for (const item of entry.messagesAdded ?? []) {
                const labels = item.message?.labelIds ?? []
                if (
                  item.message?.id &&
                  labels.includes("INBOX") &&
                  !labels.includes("SENT") &&
                  !labels.includes("DRAFT")
                ) {
                  added.set(item.message.id, item.message.threadId ?? "")
                }
              }
            }
            pageToken = response.data.nextPageToken ?? undefined
            if (pageToken === undefined) {
              if (response.data.historyId) latest = response.data.historyId
              break
            }
            const last = entries.at(-1)?.id
            if (last) latest = last
            if (added.size >= MAX_MESSAGES || page === MAX_PAGES - 1) break
          }
        } catch (error) {
          if (googleStatus(error) === 404) {
            return {
              events: [],
              cursor: { ...(await profileCursor(gmail)) },
              gap: "Gmail no longer has the history since the last poll",
            }
          }
          throw error
        }
        const events: ConnectorEvent[] = []
        for (const [id, threadId] of added) {
          let message: ReturnType<typeof readMessage>
          try {
            const response = await gmail.users.messages.get({
              userId: "me",
              id,
              format: "metadata",
              metadataHeaders: METADATA_HEADERS,
            })
            message = readMessage(response.data)
          } catch (error) {
            if (googleStatus(error) === 404) continue
            throw error
          }
          events.push({
            key: `gmail:${id}`,
            kind: MESSAGE_RECEIVED,
            occurredAt: message.internalDate ?? 0,
            summary: oneLine(
              `From: ${message.from ?? "?"} · Subject: ${message.subject ?? "(no subject)"} · ${message.snippet}`,
            ),
            ref: { message_id: id, thread_id: threadId },
            sender: senderOf(message),
          })
        }
        return { events, cursor: { historyId: latest } }
      }),
  }
}
