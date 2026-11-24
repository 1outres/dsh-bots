/**
 * The browser connector's resident resource per bot: Playwright MCP started
 * in the bot's environment, attached to the desktop's Chrome. Chrome itself
 * is the desktop's user service, so its tabs and cookies outlive the server.
 */
import type { BotConnectorAttachmentSource } from "@1outres/dsh-bot-core"
import type { GeneratedServer } from "./catalog"
import type { BrowserConnections } from "./connections"
import type { McpClientDeps } from "./mcp/client"
import { type McpServer, startServer } from "./mcp/server"
import { readVmUser } from "./vm/commands"

export interface BrowserSessionDeps extends McpClientDeps {
  readonly generated: GeneratedServer
  readonly connections: BrowserConnections
}

export function browserAttachment(
  deps: BrowserSessionDeps,
): BotConnectorAttachmentSource<McpServer> {
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
      return {
        value: server,
        ended: server.ended,
        async dispose() {
          server.close()
        },
      }
    },
  }
}
