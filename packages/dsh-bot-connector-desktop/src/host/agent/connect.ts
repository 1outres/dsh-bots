/**
 * A connection to the desktop agent in the bot's environment: `socat`
 * relays a JSON-RPC stream to the agent's Unix socket.
 */
import type { BotConnectorEnvironment } from "@1outres/dsh-bot-core"
import { agentSocket, type VmUser } from "../vm/layout"
import { createDesktopAgent, type DesktopAgent } from "./client"
import { createRpcClient, type RpcClientDeps } from "./rpc"

/** The longest line the agent may send (a screenshot in base64). */
export const MAX_AGENT_LINE_BYTES = 32 << 20

export interface AgentConnection {
  readonly agent: DesktopAgent
  /** Settles when the relay or the agent's stream ended. */
  readonly ended: Promise<unknown>
  close(): void
}

export async function connectAgent(
  environment: BotConnectorEnvironment,
  user: VmUser,
  signal: AbortSignal,
  deps: RpcClientDeps,
): Promise<AgentConnection> {
  const process = await environment.spawn({
    argv: ["socat", "-b65536", "-", `UNIX-CONNECT:${agentSocket(user)}`],
    signal,
  })
  const rpc = createRpcClient(process, deps, { maxLineBytes: MAX_AGENT_LINE_BYTES })
  const agent = createDesktopAgent(rpc)
  try {
    await agent.call("status", {}, signal)
  } catch (error) {
    process.terminate()
    const relay = process.stderr().trim()
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(relay === "" ? reason : `${reason} (${relay.split("\n").slice(-2).join("; ")})`)
  }
  return {
    agent,
    ended: Promise.race([process.done, rpc.closed]),
    close: () => process.terminate(),
  }
}
