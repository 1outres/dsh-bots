/**
 * `@1outres/dsh-bot-connector-browser` (row `bot-connector-browser`):
 * registers the `browser` connector with bot-core. This file is the
 * composition root: it reads the package's vm/ files and gives the Host
 * modules the clock.
 */
import { readFile } from "node:fs/promises"
import type { Bot } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import { GENERATED_SERVER } from "./host/catalog"
import { createBrowserConnector } from "./host/connector"
import type { McpInstallation } from "./host/preparation"

export { GENERATED_SERVER } from "./host/catalog"
export { createBrowserConnector } from "./host/connector"
export { BROWSER_CONNECTOR_ID } from "./shared/connector"

export const name = "bot-connector-browser"
/**
 * The `bot` service of @1outres/dsh-bot-core. Only types come from that
 * package: a value import would bundle bot-core's runtime into this one.
 */
const BOT = "bot"
export const inject = ["bot"]

function botOf(ctx: Context): Bot {
  const bot = ctx.get(BOT) as Bot | undefined
  if (bot === undefined) throw new Error(`the "${BOT}" service is not available; inject it`)
  return bot
}

const VM = new URL("../vm/", import.meta.url)

/** The vm/ files the preparation installs Playwright MCP from. */
export async function readMcpInstallation(directory: URL = VM): Promise<McpInstallation> {
  const read = async (path: string) => new Uint8Array(await readFile(new URL(path, directory)))
  return {
    packageJson: await read("mcp/package.json"),
    shrinkwrap: await read("mcp/npm-shrinkwrap.json"),
    script: await read("install-mcp.sh"),
  }
}

export async function apply(ctx: Context): Promise<void> {
  const bot = botOf(ctx)
  const connector = createBrowserConnector({
    generated: GENERATED_SERVER,
    installation: await readMcpInstallation(),
    deadline: (ms) => AbortSignal.timeout(ms),
  })
  ctx.effect(() => bot.registerConnector(connector), "browser: connector")
}
