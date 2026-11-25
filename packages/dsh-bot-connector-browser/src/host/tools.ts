/**
 * Every offered Playwright MCP tool as a connector tool: its upstream JSON
 * Schema and description, its permission, readOnly from the server's
 * readOnlyHint (bot-core runs only those while a person operates the
 * desktop), one call at a time per bot, and long results (page snapshots).
 */
import type {
  BotConnectorJsonArgs,
  BotConnectorResult,
  BotConnectorSchemaTool,
  BotConnectorToolDefinition,
  ConnectorPreview,
} from "@1outres/dsh-bot-core"
import type { OfferedTool } from "./catalog"
import type { BrowserConnections } from "./connections"
import { McpCallError, McpUnavailableError } from "./mcp/client"
import { McpProtocolError } from "./mcp/protocol"
import { resultOf } from "./result"
import { toolSchema } from "./schema"
import type { BrowserAttachment } from "./session"

/** Snapshots of large pages run long; bot-core cuts what is beyond. */
export const MAX_RESULT_CHARS = 128_000
/** Playwright's own navigation timeout is 60 s, its actions' 5 s; wait_for may wait longer. */
export const CALL_TIMEOUT_MS = 180_000
/** The server does not queue calls; one page, one pointer. */
export const EXCLUSIVE_PAGE = "page"

const RECONNECTED =
  "Note: the connection to the browser was opened again since your last call (the tabs and the page stay as they were). Element refs of earlier snapshots no longer work: take a new browser_snapshot. The previous call was not repeated."

export function previewOf(name: string, args: BotConnectorJsonArgs): ConnectorPreview {
  return {
    title: `Run browser_${name} in the bot's browser?`,
    fields: Object.entries(args).map(([label, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value)
      return { label, value: text.length > 300 ? `${text.slice(0, 300)}…` : text }
    }),
  }
}

/** What the model should do about a failure of the server or its connection. */
export function explain(error: unknown): Error {
  if (error instanceof McpUnavailableError || error instanceof McpProtocolError) {
    return new Error(
      `${error.message}. The next browser call starts it again; take a browser_snapshot before repeating anything.`,
    )
  }
  if (error instanceof McpCallError) return new Error(`Playwright MCP: ${error.message}`)
  return error instanceof Error ? error : new Error(String(error))
}

/** The result, after a note when it is the first since the connection was opened again. */
export function withReconnection(
  result: BotConnectorResult,
  connections: BrowserConnections,
  botId: string,
): BotConnectorResult {
  if (!connections.takeReconnected(botId)) return result
  return {
    ...result,
    text: [RECONNECTED, ...(result.text === undefined ? [] : [result.text])].join("\n\n"),
  }
}

export function browserTools(
  offered: readonly OfferedTool[],
  connections: BrowserConnections,
): readonly BotConnectorToolDefinition<BrowserAttachment>[] {
  return offered.map((entry): BotConnectorToolDefinition<BrowserAttachment> => {
    const tool: BotConnectorSchemaTool<BrowserAttachment> = {
      name: entry.name,
      description: entry.upstream.description,
      inputSchema: toolSchema(entry.upstream.inputSchema, entry.upstream.name),
      permission: entry.permission,
      readOnly: entry.readOnly,
      exclusive: EXCLUSIVE_PAGE,
      maxResultChars: MAX_RESULT_CHARS,
      preview: (args) => previewOf(entry.name, args),
      async execute(args, run) {
        let result: BotConnectorResult
        try {
          result = await resultOf(
            await run.attachment.mcp.callTool(entry.upstream.name, args, {
              signal: run.signal,
              timeoutMs: CALL_TIMEOUT_MS,
            }),
            run,
          )
        } catch (error) {
          throw explain(error)
        }
        return withReconnection(result, connections, run.bot.id)
      },
    }
    return tool
  })
}
