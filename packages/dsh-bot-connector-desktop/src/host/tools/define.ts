import type {
  BotConnectorResult,
  BotConnectorRun,
  BotConnectorTool,
  BotConnectorToolDefinition,
  ConnectorPreview,
} from "@1outres/dsh-bot-core"
import { AgentResponseError } from "../agent/check"
import { AgentCallError, AgentUnavailableError } from "../agent/rpc"
import type { DesktopControl, DesktopNotice } from "../control"
import { ScreenshotRequiredError } from "../frame"
import type { DesktopSession } from "../session"

export type Parameters = NonNullable<BotConnectorTool["parameters"]>
export type ArgsOf<S extends Parameters> = Parameters_<
  BotConnectorTool<S, DesktopSession>["execute"]
>[0]
type Parameters_<F> = F extends (...args: infer P) => unknown ? P : never

export type DesktopRun = BotConnectorRun<DesktopSession>

export type ToolKind = "observe" | "operate"

export interface DesktopToolSpec<S extends Parameters> {
  readonly name: string
  readonly description: string
  readonly parameters: S
  readonly kind: ToolKind | ((args: ArgsOf<S>) => ToolKind)
  readonly concurrent?: true
  readonly vault?: true
  readonly maxResultChars?: number
  preview(args: ArgsOf<S>): ConnectorPreview
  run(args: ArgsOf<S>, run: DesktopRun): Promise<BotConnectorResult>
}

export interface DesktopToolDeps {
  readonly control: DesktopControl
}

export const EXCLUSIVE_DISPLAY = "display"
export const USER_IN_CONTROL = "USER_IN_CONTROL"

const NOTICES: Record<DesktopNotice, string> = {
  "control-returned":
    "Note: a person operated this desktop since your last action, so the screen may have changed. Look again (desktop_tree or desktop_screenshot) before using earlier element ids or coordinates.",
  reconnected:
    "Note: the connection to the desktop was opened again: the earlier screenshot no longer maps coordinates and element ids may be stale. Take a new desktop_tree or desktop_screenshot; the previous call was not repeated.",
}

export function explain(error: unknown, session: DesktopSession): Error {
  if (error instanceof ScreenshotRequiredError) return error
  if (error instanceof AgentCallError) {
    if (error.code === "screen_changed") {
      session.frames.forget()
      return new ScreenshotRequiredError(`the screen size changed (${error.message})`)
    }
    return new Error(`${error.code}: ${error.message}`)
  }
  if (error instanceof AgentUnavailableError) {
    return new Error(
      `${error.message}. The next desktop call connects again; check the screen before repeating anything.`,
    )
  }
  if (error instanceof AgentResponseError) {
    return new Error(
      `${error.message}; the call may have taken effect, so check the screen before repeating it.`,
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}

function withNotices(
  result: BotConnectorResult,
  notices: readonly DesktopNotice[],
): BotConnectorResult {
  if (notices.length === 0) return result
  const lines = notices.map((notice) => NOTICES[notice])
  return {
    ...result,
    text: [...lines, ...(result.text === undefined ? [] : [result.text])].join("\n\n"),
  }
}

export function argumentFields(args: object): ConnectorPreview["fields"] {
  return Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value)
      return { label, value: text.length > 300 ? `${text.slice(0, 300)}…` : text }
    })
}

export function desktopTool<const S extends Parameters>(
  spec: DesktopToolSpec<S>,
  deps: DesktopToolDeps,
): BotConnectorToolDefinition<DesktopSession> {
  const tool: BotConnectorTool<S, DesktopSession> = {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    permission: "allow",
    ...(spec.concurrent === true ? {} : { exclusive: EXCLUSIVE_DISPLAY }),
    ...(spec.maxResultChars === undefined ? {} : { maxResultChars: spec.maxResultChars }),
    ...(spec.vault === undefined ? {} : { vault: spec.vault }),
    preview: (args) => spec.preview(args),
    async execute(args, run) {
      const kind = typeof spec.kind === "function" ? spec.kind(args) : spec.kind
      if (kind === "operate" && deps.control.view(run.bot.id).controller === "human") {
        throw new Error(
          `${USER_IN_CONTROL}: a person is operating this desktop now. Do not retry in a loop; continue with other work or ask them to hand it back.`,
        )
      }
      let result: BotConnectorResult
      try {
        result = await spec.run(args, run)
      } catch (error) {
        throw explain(error, run.attachment)
      }
      return withNotices(result, deps.control.takeNotices(run.bot.id))
    },
  }
  return tool as BotConnectorToolDefinition<DesktopSession>
}
