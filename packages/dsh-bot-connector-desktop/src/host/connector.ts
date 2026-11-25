/**
 * The desktop connector (docs/specs/bot-connectors.md, 9): an XFCE desktop on
 * Xvnc in the bot's environment, driven through the dsh-desktop-agent there
 * (accessibility tree first, input and screenshots), for every session of the bot.
 */
import type { BotConnector } from "@1outres/dsh-bot-core"
import { DESKTOP_CONNECTOR_ID } from "../shared/connector"
import type { RpcClientDeps } from "./agent/rpc"
import type { DesktopControl } from "./control"
import { screenStream } from "./screen/stream"
import { type DesktopSession, desktopAttachment } from "./session"
import { DESKTOP_SETTINGS } from "./settings"
import { desktopTools } from "./tools"
import type { VmSourceFile } from "./vm/files"
import { createDesktopPreparation } from "./vm/preparation"

export { DESKTOP_CONNECTOR_ID }
/** The least memory the desktop runs in: Chrome and LibreOffice side by side need 1–1.2 GiB beyond the desktop itself. */
export const DESKTOP_MIN_MEMORY_MIB = 4096

export interface DesktopConnectorDeps extends RpcClientDeps {
  /** The package's vm/ directory. */
  readonly sources: readonly VmSourceFile[]
  readonly control: DesktopControl
  now(): number
}

export function createDesktopConnector(deps: DesktopConnectorDeps): BotConnector<DesktopSession> {
  return {
    id: DESKTOP_CONNECTOR_ID,
    name: "Desktop",
    description: {
      en: "A desktop in the bot's VM (LibreOffice, Google Chrome, a terminal) that the bot reads through accessibility and operates with input.",
      ja: "ボットの VM のデスクトップ（LibreOffice、Google Chrome、端末）。ボットは画面要素ツリーで読み、入力で操作します。",
    },
    sessions: "bot",
    minimumSpec: { memoryMiB: DESKTOP_MIN_MEMORY_MIB },
    creationOption: "workstation",
    settings: DESKTOP_SETTINGS,
    preparation: {
      ...createDesktopPreparation({
        sources: deps.sources,
        deadline: deps.deadline,
        vaultKit: deps.vaultKit,
      }),
      hint: {
        en: "The first preparation can take several minutes in some VMs.",
        ja: "VM によっては、初めての準備に数分かかることがあります。",
      },
    },
    attachment: desktopAttachment({
      control: deps.control,
      deadline: deps.deadline,
      vaultKit: deps.vaultKit,
    }),
    tools: desktopTools({ control: deps.control, deadline: deps.deadline, now: deps.now }),
    panel: {
      title: { en: "Desktop", ja: "デスクトップ" },
      icon: "desktop",
      streams: [screenStream(deps.control)],
    },
    status: {
      read: (botId) => deps.control.status(botId),
      subscribe: (listener) => deps.control.subscribe((botId) => listener(botId)),
    },
  }
}
