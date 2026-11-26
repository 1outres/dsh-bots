import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { Bot } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import { createDesktopConnector } from "./host/connector"
import { DesktopControl } from "./host/control"
import type { VmSourceFile } from "./host/vm/files"

export { createDesktopConnector, DESKTOP_CONNECTOR_ID } from "./host/connector"
export { DesktopControl, type DesktopController, type DesktopControlView } from "./host/control"

export const name = "bot-connector-desktop"
const BOT = "bot"
export const inject = ["bot"]

function botOf(ctx: Context): Bot {
  const bot = ctx.get(BOT) as Bot | undefined
  if (bot === undefined) throw new Error(`the "${BOT}" service is not available; inject it`)
  return bot
}

const VM_DIRECTORY = fileURLToPath(new URL("../vm/", import.meta.url))

export async function readVmSources(directory: string = VM_DIRECTORY): Promise<VmSourceFile[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.endsWith(".pyc"))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.split(sep).includes("__pycache__"))
    .sort()
  return Promise.all(
    files.map(async (path) => ({
      path: relative(directory, path).split(sep).join("/"),
      data: new Uint8Array(await readFile(path)),
    })),
  )
}

export async function apply(ctx: Context): Promise<void> {
  const bot = botOf(ctx)
  const sources = await readVmSources()
  const control = new DesktopControl(() => Date.now())
  const connector = createDesktopConnector({
    sources,
    control,
    deadline: (ms) => AbortSignal.timeout(ms),
    vaultKit: bot.vaultKit(),
    now: () => Date.now(),
  })
  ctx.effect(() => bot.registerConnector(connector), "desktop: connector")
}
