import type { ConnectorSender } from "@1outres/dsh-bot-core"
import { readMailboxes } from "./addresses"
import { verifiesFrom } from "./authentication"
import type { ReadMessage } from "./message"

export const SENT_LABEL = "SENT"

export function senderOf(message: ReadMessage): ConnectorSender {
  if (message.labelIds.includes(SENT_LABEL)) return { kind: "self" }
  const from = readMailboxes(message.from)
  const mailbox = from.length === 1 ? from[0] : undefined
  if (mailbox === undefined) return { kind: "anonymous" }
  const domain = mailbox.address.slice(mailbox.address.lastIndexOf("@") + 1)
  return {
    kind: "external",
    address: mailbox.address,
    verified: verifiesFrom(message.authenticationResults, domain),
  }
}
