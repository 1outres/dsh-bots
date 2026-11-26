import { randomBytes } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import type { Bot } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import { GENERATED_SERVER } from "./host/catalog"
import { createBrowserConnector } from "./host/connector"
import type { BrowserInstallation } from "./host/preparation"

export { GENERATED_SERVER } from "./host/catalog"
export { createBrowserConnector } from "./host/connector"
export { BROWSER_CONNECTOR_ID } from "./shared/connector"

export const name = "bot-connector-browser"
const BOT = "bot"
export const inject = ["bot"]

function botOf(ctx: Context): Bot {
  const bot = ctx.get(BOT) as Bot | undefined
  if (bot === undefined) throw new Error(`the "${BOT}" service is not available; inject it`)
  return bot
}

const VM = new URL("../vm/", import.meta.url)

export async function readBrowserInstallation(directory: URL = VM): Promise<BrowserInstallation> {
  const read = async (path: string) => new Uint8Array(await readFile(new URL(path, directory)))
  const helpers = (await readdir(new URL("helper/", directory)))
    .filter((name) => name.endsWith(".mjs"))
    .sort()
  return {
    mcp: {
      packageJson: await read("mcp/package.json"),
      shrinkwrap: await read("mcp/npm-shrinkwrap.json"),
      script: await read("install-mcp.sh"),
    },
    helper: {
      files: await Promise.all(
        helpers.map(async (name) => ({ name, data: await read(`helper/${name}`) })),
      ),
      script: await read("install-helper.sh"),
    },
  }
}

export async function apply(ctx: Context): Promise<void> {
  const bot = botOf(ctx)
  const connector = createBrowserConnector({
    generated: GENERATED_SERVER,
    installation: await readBrowserInstallation(),
    kit: bot.vaultKit(),
    mark: () => randomBytes(16).toString("hex"),
    deadline: (ms) => AbortSignal.timeout(ms),
  })
  ctx.effect(() => bot.registerConnector(connector), "browser: connector")
}
