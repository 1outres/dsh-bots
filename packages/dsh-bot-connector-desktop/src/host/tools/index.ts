import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import type { DesktopSession } from "../session"
import { clipboardTools } from "./clipboard"
import { credentialTools } from "./credentials"
import type { DesktopToolDeps } from "./define"
import { elementTools } from "./elements"
import { type HandoffDeps, handoffTools } from "./handoff"
import { keyboardTools } from "./keyboard"
import { pointerTools } from "./pointer"
import { screenTools } from "./screen"
import { sheetTools } from "./sheet"
import { windowTools } from "./windows"

export type DesktopToolsDeps = DesktopToolDeps & Omit<HandoffDeps, "control">

export function desktopTools(
  deps: DesktopToolsDeps,
): readonly BotConnectorToolDefinition<DesktopSession>[] {
  return [
    ...elementTools(deps),
    ...sheetTools(deps),
    ...windowTools(deps),
    ...keyboardTools(deps),
    ...pointerTools(deps),
    ...clipboardTools(deps),
    ...credentialTools(deps),
    ...screenTools(deps),
    ...handoffTools(deps),
  ]
}
