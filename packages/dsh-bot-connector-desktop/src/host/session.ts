/**
 * The desktop connector's resident resource per bot: the connection to the
 * agent and the frame of the latest screenshot on that connection.
 */
import type { BotConnectorAttachmentSource } from "@1outres/dsh-bot-core"
import type { DesktopAgent } from "./agent/client"
import { connectAgent } from "./agent/connect"
import type { RpcClientDeps } from "./agent/rpc"
import type { DesktopControl } from "./control"
import { FrameMemory } from "./frame"
import { readVmUser } from "./vm/commands"

export interface DesktopSession {
  readonly agent: DesktopAgent
  readonly frames: FrameMemory
}

export interface DesktopAttachmentDeps extends RpcClientDeps {
  readonly control: DesktopControl
}

export function desktopAttachment(
  deps: DesktopAttachmentDeps,
): BotConnectorAttachmentSource<DesktopSession> {
  return {
    async open(context) {
      const user = await readVmUser(context.environment, context.signal)
      const connection = await connectAgent(context.environment, user, context.signal, deps)
      deps.control.connected(context.bot.id)
      return {
        value: { agent: connection.agent, frames: new FrameMemory() },
        ended: connection.ended,
        async dispose() {
          connection.close()
        },
      }
    },
  }
}
