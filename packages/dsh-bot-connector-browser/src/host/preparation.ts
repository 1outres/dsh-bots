import type { BotConnectorContext, BotConnectorPreparation } from "@1outres/dsh-bot-core"
import { type GeneratedServer, toolDifferences } from "./catalog"
import type { McpClientDeps } from "./mcp/client"
import { startServer } from "./mcp/server"
import { readVmUser, run } from "./vm/commands"
import {
  CDP_ENDPOINT,
  HELPER_DIR,
  helperStagingDir,
  MCP_DIR,
  MCP_SHRINKWRAP,
  stagingDir,
  type VmUser,
} from "./vm/layout"

export interface McpInstallation {
  readonly packageJson: Uint8Array
  readonly shrinkwrap: Uint8Array
  readonly script: Uint8Array
}

export interface HelperInstallation {
  readonly files: readonly { readonly name: string; readonly data: Uint8Array }[]
  readonly script: Uint8Array
}

export interface BrowserInstallation {
  readonly mcp: McpInstallation
  readonly helper: HelperInstallation
}

export interface BrowserPreparationDeps extends McpClientDeps {
  readonly generated: GeneratedServer
  readonly installation: BrowserInstallation
}

const HELPER_FILE = /^[a-z][a-z0-9-]*\.mjs$/

const INSTALL_TIMEOUT_MS = 15 * 60_000

export function chromeVersion(answer: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    throw new Error(`${CDP_ENDPOINT} did not answer with JSON`)
  }
  const browser = (parsed as { Browser?: unknown } | null)?.Browser
  if (typeof browser !== "string" || !/^Chrome\/[0-9.]+$/.test(browser)) {
    throw new Error(`${CDP_ENDPOINT} is not Chrome's DevTools`)
  }
  return browser
}

export function createBrowserPreparation(deps: BrowserPreparationDeps): BotConnectorPreparation {
  const decoder = new TextDecoder()

  const install = async (context: BotConnectorContext, user: VmUser) => {
    const stage = stagingDir(user)
    const { signal, environment } = context
    await run(environment, ["rm", "-rf", "--", stage], { signal })
    await run(environment, ["mkdir", "-p", "-m", "0700", "--", stage], { signal })
    const files: readonly [string, Uint8Array][] = [
      ["package.json", deps.installation.mcp.packageJson],
      ["npm-shrinkwrap.json", deps.installation.mcp.shrinkwrap],
      ["install-mcp.sh", deps.installation.mcp.script],
    ]
    for (const [name, data] of files) {
      await environment.writeFile(`${stage}/${name}`, data, { mode: 0o644, signal })
    }
    await run(environment, ["sudo", "-n", "sh", `${stage}/install-mcp.sh`, stage, MCP_DIR], {
      signal,
      timeoutMs: INSTALL_TIMEOUT_MS,
    })
    await run(environment, ["rm", "-rf", "--", stage], { signal })
  }

  const installed = async (context: BotConnectorContext) => {
    const current = await run(context.environment, ["cat", "--", MCP_SHRINKWRAP], {
      signal: context.signal,
      accept: [0, 1],
      maxOutputBytes: 4 << 20,
    })
    return (
      current.exitCode === 0 && current.stdout === decoder.decode(deps.installation.mcp.shrinkwrap)
    )
  }

  const helperInstalled = async (context: BotConnectorContext) => {
    for (const file of deps.installation.helper.files) {
      const current = await run(context.environment, ["cat", "--", `${HELPER_DIR}/${file.name}`], {
        signal: context.signal,
        accept: [0, 1],
        maxOutputBytes: 1 << 20,
      })
      if (current.exitCode !== 0 || current.stdout !== decoder.decode(file.data)) return false
    }
    return true
  }

  const installHelper = async (context: BotConnectorContext, user: VmUser) => {
    const stage = helperStagingDir(user)
    const { signal, environment } = context
    await run(environment, ["rm", "-rf", "--", stage], { signal })
    await run(environment, ["mkdir", "-p", "-m", "0700", "--", stage], { signal })
    for (const file of deps.installation.helper.files) {
      if (!HELPER_FILE.test(file.name))
        throw new Error(`vm/helper/${file.name} is not a helper module`)
      await environment.writeFile(`${stage}/${file.name}`, file.data, { mode: 0o644, signal })
    }
    await environment.writeFile(`${stage}/install-helper.sh`, deps.installation.helper.script, {
      mode: 0o644,
      signal,
    })
    await run(environment, ["sudo", "-n", "sh", `${stage}/install-helper.sh`, stage, HELPER_DIR], {
      signal,
    })
    await run(environment, ["rm", "-rf", "--", stage], { signal })
  }

  const checkTools = async (context: BotConnectorContext, user: VmUser) => {
    const server = await startServer(
      context.environment,
      user,
      deps.generated.arguments,
      context.signal,
      deps,
    )
    try {
      const differences = toolDifferences(
        deps.generated.tools,
        await server.listTools(context.signal),
      )
      if (differences.length > 0) {
        throw new Error(
          `Playwright MCP in the bot's VM lists other tools than this connector was built with (${deps.generated.package} ${deps.generated.version}): ${differences.slice(0, 8).join(", ")}`,
        )
      }
    } finally {
      server.close()
    }
  }

  return {
    async prepare(context, progress) {
      progress("reading the bot's account")
      const user = await readVmUser(context.environment, context.signal)
      progress("checking Playwright MCP")
      if (!(await installed(context))) {
        progress(`installing Playwright MCP ${deps.generated.version}`)
        await install(context, user)
      }
      progress("checking the login helpers")
      if (!(await helperInstalled(context))) {
        progress("installing the login helpers")
        await installHelper(context, user)
      }
      progress("checking the desktop's Chrome")
      const answer = await run(
        context.environment,
        ["curl", "-sf", "--max-time", "10", `${CDP_ENDPOINT}/json/version`],
        { signal: context.signal },
      )
      chromeVersion(answer.stdout)
      progress("checking Playwright MCP's tools")
      await checkTools(context, user)
    },
  }
}
