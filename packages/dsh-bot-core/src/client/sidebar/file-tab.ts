import type { SidebarRightTabsFace } from "../dsh/sidebar-right"
import { baseName, botFileTarget, SESSION_FILE_PATTERN } from "../file-address"
import type { SessionClass } from "../session-classification"

export const BOT_FILE_TAB_ID = "@1outres/dsh-bot-core/file"
export const BOT_FILE_TAB_KIND = "bot-core.file"

/** How a session is shown, as far as the lockdown asks. */
export type ClassifySession = (sessionId: string) => Pick<SessionClass, "kind">

export type FileTabDefinition = Parameters<SidebarRightTabsFace["register"]>[0]

/**
 * bot-core's tab type: it claims every session file address at the `extension`
 * band (above DSH's previews) and opens only a bot session's, so other sessions'
 * files stay with DSH.
 */
export function botFileTabDefinition(classify: ClassifySession): FileTabDefinition {
  const isBotSession = (sessionId: string) => classify(sessionId).kind === "bot"
  return {
    id: BOT_FILE_TAB_ID,
    kind: BOT_FILE_TAB_KIND,
    patterns: [SESSION_FILE_PATTERN],
    priority: "extension",
    canOpen: (address) => botFileTarget(address, isBotSession) !== undefined,
    title: (address) => {
      const target = botFileTarget(address, () => true)
      return target === undefined ? address : baseName(target.path)
    },
  }
}
