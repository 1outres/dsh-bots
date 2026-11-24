/**
 * Making the bot's environment ready for the browser, one idempotent path
 * (the desktop, which runs the Chrome it drives, is ready before: the
 * connector requires it): Playwright MCP installed from the pinned
 * npm-shrinkwrap.json when the installed one differs, the desktop's Chrome answering DevTools,
 * and the server listing exactly the generated tools.
 */
import type { BotConnectorContext, BotConnectorPreparation } from "@1outres/dsh-bot-core"
import { type GeneratedServer, toolDifferences } from "./catalog"
import type { McpClientDeps } from "./mcp/client"
import { startServer } from "./mcp/server"
import { readVmUser, run } from "./vm/commands"
import { CDP_ENDPOINT, MCP_DIR, MCP_SHRINKWRAP, stagingDir, type VmUser } from "./vm/layout"

/** The package's vm/ files the preparation installs from. */
export interface McpInstallation {
  readonly packageJson: Uint8Array
  readonly shrinkwrap: Uint8Array
  /** vm/install-mcp.sh, which the base image build runs too. */
  readonly script: Uint8Array
}

export interface BrowserPreparationDeps extends McpClientDeps {
  readonly generated: GeneratedServer
  readonly installation: McpInstallation
}

const INSTALL_TIMEOUT_MS = 15 * 60_000

/** What the desktop's Chrome says on DevTools' /json/version. @throws for anything but Chrome. */
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
      ["package.json", deps.installation.packageJson],
      ["npm-shrinkwrap.json", deps.installation.shrinkwrap],
      ["install-mcp.sh", deps.installation.script],
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
    return current.exitCode === 0 && current.stdout === decoder.decode(deps.installation.shrinkwrap)
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
