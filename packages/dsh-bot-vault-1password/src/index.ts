import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths"
import { download } from "./cli/download"
import { createOpInstaller } from "./cli/install"
import { OP_RELEASE } from "./cli/release"
import { createStatusCell } from "./cli/status"
import { onePasswordProvider } from "./provider"

export const name = "bot-vault-1password"
export const inject = ["bot"]

/** The plugin's data directory: `<DSH home>/bot-vault-1password` (the CLI under `op/<version>/`). */
export const dataDirectory = () => join(resolveDshHome(), name)

/** Registers 1Password as a password manager of the bots, and installs its CLI. */
export function apply(ctx: Context): void {
  // bot-core is a peer dependency: its types only, the service by name.
  const bot = ctx.get("bot") as Bot
  const lifetime = new AbortController()
  const status = createStatusCell({ state: "preparing", step: "Checking the 1Password CLI" })
  const installer = createOpInstaller({
    release: OP_RELEASE,
    platform: `${process.platform}-${process.arch}`,
    directory: dataDirectory(),
    status,
    download,
    signal: lifetime.signal,
  })
  const provider = onePasswordProvider({
    installer,
    secret: bot.vaultKit().secret,
    temporaryDirectory: tmpdir(),
    now: () => Date.now(),
  })
  ctx.effect(() => bot.registerVaultProvider(provider), "bot-vault-1password: provider")
  ctx.effect(() => {
    installer.binary(lifetime.signal).catch((error: unknown) => {
      if (!lifetime.signal.aborted) {
        ctx.logger.warn(error instanceof Error ? error.message : String(error))
      }
    })
    return () => lifetime.abort()
  }, "bot-vault-1password: CLI")
}
