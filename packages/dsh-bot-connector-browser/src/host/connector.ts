/**
 * The browser connector (docs/specs/bot-connectors.md, 9 and 15): the
 * desktop's Google Chrome in the bot's environment, driven by Playwright
 * MCP there over DevTools, for every session of the bot. It requires the
 * desktop: the browser is the one on the screen a person watches.
 */
import type { BotConnector, VaultKit } from "@1outres/dsh-bot-core"
import { BROWSER_CONNECTOR_ID, DESKTOP_CONNECTOR_ID } from "../shared/connector"
import { type GeneratedServer, offeredTools } from "./catalog"
import { BrowserConnections } from "./connections"
import type { McpClientDeps } from "./mcp/client"
import { type BrowserInstallation, createBrowserPreparation } from "./preparation"
import { type BrowserAttachment, browserAttachment } from "./session"
import { browserTools } from "./tools"
import { vaultTools } from "./vault/tools"

/** The least memory for Chrome's pages beside Playwright MCP's Node process. */
export const BROWSER_MIN_MEMORY_MIB = 3072

export interface BrowserConnectorDeps extends McpClientDeps {
  readonly generated: GeneratedServer
  readonly installation: BrowserInstallation
  readonly kit: VaultKit
  /** A new one-time mark for a login's target (32 lower-case hex digits). */
  mark(): string
}

export function createBrowserConnector(
  deps: BrowserConnectorDeps,
): BotConnector<BrowserAttachment> {
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
    tools: [
      ...browserTools(offeredTools(deps.generated.tools), connections),
      ...vaultTools({ ...deps, connections }),
    ],
  }
}
