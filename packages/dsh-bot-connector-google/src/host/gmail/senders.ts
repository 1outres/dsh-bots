import type { BotConnectorSenderSource, SenderRecipient } from "@1outres/dsh-bot-core"
import type { Google } from "../google"
import { readMailboxes, sameAddress } from "./addresses"
import { readMessage } from "./message"
import { SENT_LABEL } from "./sender"

const PAGE = 100
const BATCH = 20
const RECIPIENT_HEADERS = ["To", "Cc", "Bcc"]

export function gmailSenders(google: Google): BotConnectorSenderSource {
  return {
    kind: "email",
    recipients: ({ connection, limit, signal }) =>
      google.as(connection, async ({ gmail }) => {
        const ids: string[] = []
        let pageToken: string | undefined
        while (ids.length < limit) {
          signal.throwIfAborted()
          const listed = await gmail.users.messages.list({
            userId: "me",
            labelIds: [SENT_LABEL],
            maxResults: Math.min(PAGE, limit - ids.length),
            ...(pageToken === undefined ? {} : { pageToken }),
          })
          for (const item of listed.data.messages ?? []) if (item.id) ids.push(item.id)
          pageToken = listed.data.nextPageToken ?? undefined
          if (pageToken === undefined) break
        }
        const own = connection.info.account.email
        const counts = new Map<string, { address: string; name?: string; messages: number }>()
        for (let start = 0; start < ids.length; start += BATCH) {
          signal.throwIfAborted()
          const batch = await Promise.all(
            ids
              .slice(start, start + BATCH)
              .map((id) =>
                gmail.users.messages
                  .get({ userId: "me", id, format: "metadata", metadataHeaders: RECIPIENT_HEADERS })
                  .then((response) => readMessage(response.data)),
              ),
          )
          for (const message of batch) {
            const seen = new Set<string>()
            for (const mailbox of [message.to, message.cc, message.bcc].flatMap(readMailboxes)) {
              const key = mailbox.address.toLowerCase()
              if (seen.has(key) || (own !== undefined && sameAddress(key, own))) continue
              seen.add(key)
              const previous = counts.get(key)
              counts.set(key, {
                address: key,
                messages: (previous?.messages ?? 0) + 1,
                ...((previous?.name ?? mailbox.name) === undefined
                  ? {}
                  : { name: previous?.name ?? mailbox.name }),
              })
            }
          }
        }
        const recipients: SenderRecipient[] = [...counts.values()]
        return { scanned: ids.length, recipients }
      }),
  }
}
