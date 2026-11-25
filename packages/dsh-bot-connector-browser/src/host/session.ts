/**
 * The browser connector's resident resource per bot: Playwright MCP started
 * in the bot's environment, attached to the desktop's Chrome, and the
 * passkey offered there, if any. Chrome itself is the desktop's user
 * service, so its tabs and cookies outlive the server.
 */
import type { BotConnectorAttachmentSource, VaultKit } from "@1outres/dsh-bot-core"
import type { GeneratedServer } from "./catalog"
import type { BrowserConnections } from "./connections"
import type { McpClientDeps } from "./mcp/client"
import { type McpServer, startServer } from "./mcp/server"
import { type PasskeySlot, passkeySlot } from "./vault/passkeys"
import { readVmUser } from "./vm/commands"

export interface BrowserAttachment {
  readonly mcp: McpServer
  readonly passkeys: PasskeySlot
}

export interface BrowserSessionDeps extends McpClientDeps {
  readonly generated: GeneratedServer
  readonly connections: BrowserConnections
  readonly kit: VaultKit
}

export function browserAttachment(
  deps: BrowserSessionDeps,
): BotConnectorAttachmentSource<BrowserAttachment> {
  return {
    async open(context) {
      const user = await readVmUser(context.environment, context.signal)
      const server = await startServer(
        context.environment,
        user,
        deps.generated.arguments,
        context.signal,
        deps,
      )
      deps.connections.connected(context.bot.id)
      const passkeys = passkeySlot({
        environment: context.environment,
        signal: context.signal,
        kit: deps.kit,
        deadline: deps.deadline,
      })
      return {
        value: { mcp: server, passkeys },
        ended: server.ended,
        async dispose() {
          passkeys.release()
          server.close()
        },
      }
    },
  }
}
