/**
 * Playwright MCP in the bot's environment: started over bot-core's
 * environment access with the arguments its tools were generated with,
 * attached to the desktop's Chrome over DevTools, and initialized.
 */
import type { BotConnectorEnvironment } from "@1outres/dsh-bot-core"
import { CDP_ENDPOINT, MCP_CLI, OUTPUT_MAX_BYTES, outputDir, type VmUser } from "../vm/layout"
import { createMcpClient, type McpClientDeps } from "./client"
import {
  type McpCallResult,
  type McpTool,
  PROTOCOL_VERSION,
  parseCallResult,
  parseInitialize,
  parseToolList,
} from "./protocol"

/** The longest line the server may send (a full-page screenshot in base64). */
export const MAX_SERVER_LINE_BYTES = 48 << 20
const START_TIMEOUT_MS = 60_000
const LIST_TIMEOUT_MS = 30_000

export interface McpServer {
  readonly server: { readonly name: string; readonly version: string }
  listTools(signal: AbortSignal): Promise<readonly McpTool[]>
  callTool(
    name: string,
    args: object,
    options: { readonly signal: AbortSignal; readonly timeoutMs: number },
  ): Promise<McpCallResult>
  /** Settles when the server's process or its stream ended. */
  readonly ended: Promise<unknown>
  close(): void
}

/**
 * The server's command line: `toolArguments` (what its tools were listed
 * with), the desktop's Chrome, results without generated code, and file
 * links (screenshots, snapshots) as absolute paths the bot can read.
 */
export function serverArgv(user: VmUser, toolArguments: readonly string[]): readonly string[] {
  return [
    "node",
    MCP_CLI,
    ...toolArguments,
    "--cdp-endpoint",
    CDP_ENDPOINT,
    "--codegen",
    "none",
    "--file-paths",
    "absolute",
    "--output-dir",
    outputDir(user),
    "--output-max-size",
    String(OUTPUT_MAX_BYTES),
  ]
}

export async function startServer(
  environment: BotConnectorEnvironment,
  user: VmUser,
  toolArguments: readonly string[],
  signal: AbortSignal,
  deps: McpClientDeps,
): Promise<McpServer> {
  const process = await environment.spawn({ argv: serverArgv(user, toolArguments), signal })
  const client = createMcpClient(process, deps, { maxLineBytes: MAX_SERVER_LINE_BYTES })
  let server: McpServer["server"]
  try {
    server = parseInitialize(
      await client.request(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "dsh-bot-connector-browser", version: "1" },
        },
        { timeoutMs: START_TIMEOUT_MS, signal },
      ),
    )
    await client.notify("notifications/initialized")
  } catch (error) {
    process.terminate()
    const log = process.stderr().trim()
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(log === "" ? reason : `${reason} (${log.split("\n").slice(-3).join("; ")})`)
  }
  return {
    server,
    async listTools(listSignal) {
      return parseToolList(
        await client.request("tools/list", {}, { timeoutMs: LIST_TIMEOUT_MS, signal: listSignal }),
      )
    },
    async callTool(name, args, options) {
      return parseCallResult(await client.request("tools/call", { name, arguments: args }, options))
    },
    ended: Promise.race([process.done, client.closed]),
    close: () => process.terminate(),
  }
}
