/**
 * The browser connector (docs/specs/bot-connectors.md, 9 and 15): the
 * desktop's Google Chrome in the bot's environment, driven by Playwright
 * MCP there over DevTools, for every session of the bot. It requires the
 * desktop: the browser is the one on the screen a person watches.
 */
import type { BotConnector } from "@1outres/dsh-bot-core"
import { BROWSER_CONNECTOR_ID, DESKTOP_CONNECTOR_ID } from "../shared/connector"
import { type GeneratedServer, offeredTools } from "./catalog"
import { BrowserConnections } from "./connections"
import type { McpClientDeps } from "./mcp/client"
import type { McpServer } from "./mcp/server"
import { createBrowserPreparation, type McpInstallation } from "./preparation"
import { browserAttachment } from "./session"
import { browserTools } from "./tools"

/** The least memory for Chrome's pages beside Playwright MCP's Node process. */
export const BROWSER_MIN_MEMORY_MIB = 3072

export interface BrowserConnectorDeps extends McpClientDeps {
  readonly generated: GeneratedServer
  readonly installation: McpInstallation
}

export function createBrowserConnector(deps: BrowserConnectorDeps): BotConnector<McpServer> {
  const connections = new BrowserConnections()
  return {
    id: BROWSER_CONNECTOR_ID,
    name: "Browser",
    description: {
      en: "The Google Chrome on the bot's desktop, which the bot drives with Playwright MCP in its VM (page snapshots, forms, screenshots). Needs the desktop.",
      ja: "ボットのデスクトップの Google Chrome。ボットは VM の中の Playwright MCP で操作します（ページのスナップショット、フォーム、スクリーンショット）。デスクトップが必要です。",
    },
    sessions: "bot",
    minimumSpec: { memoryMiB: BROWSER_MIN_MEMORY_MIB },
    requires: [DESKTOP_CONNECTOR_ID],
    creationOption: "workstation",
    preparation: {
      ...createBrowserPreparation(deps),
      hint: {
        en: "The browser is prepared after the desktop; the first time can take a minute.",
        ja: "ブラウザはデスクトップのあとに準備されます。初回は 1 分ほどかかることがあります。",
      },
    },
    attachment: browserAttachment({ ...deps, connections }),
    tools: browserTools(offeredTools(deps.generated.tools), connections),
  }
}
