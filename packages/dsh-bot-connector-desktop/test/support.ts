import type {
  BotConnectorEnvironment,
  BotConnectorImageInput,
  BotConnectorRun,
  BotConnectorToolDefinition,
  BotEnvironmentCommand,
  BotEnvironmentCommandResult,
  ConnectorJson,
} from "@1outres/dsh-bot-core"
import { VAULT_KIT } from "@1outres/dsh-bot-core"
import type { DesktopAgent } from "../src/host/agent/client"
import type {
  AgentMethod,
  AgentParams,
  SecretAgentMethod,
  SecretAgentParams,
} from "../src/host/agent/protocol"
import { RESULTS } from "../src/host/agent/protocol"
import { DesktopControl } from "../src/host/control"
import { FrameMemory } from "../src/host/frame"
import type { DesktopSession } from "../src/host/session"
import { desktopTools } from "../src/host/tools"

export { VAULT_KIT }

export interface AgentCall {
  readonly method: AgentMethod | SecretAgentMethod
  readonly params: unknown
}

type Answer = (params: never) => unknown

export function fakeAgent(
  answers: Partial<Record<AgentMethod | SecretAgentMethod, Answer | Error>>,
) {
  const calls: AgentCall[] = []
  const secrets: Uint8Array[] = []
  const answer = (method: AgentMethod | SecretAgentMethod, params: unknown) => {
    calls.push({ method, params })
    const found = answers[method]
    if (found === undefined) throw new Error(`unexpected agent call ${method}`)
    if (found instanceof Error) throw found
    return RESULTS[method]((found as (p: unknown) => unknown)(params), method) as never
  }
  const agent: DesktopAgent = {
    async call<M extends AgentMethod>(method: M, params: AgentParams[M]) {
      return answer(method, params)
    },
    async callSecret<M extends SecretAgentMethod>(
      method: M,
      params: SecretAgentParams[M],
      secret: Parameters<DesktopAgent["callSecret"]>[2],
    ) {
      await secret.use((bytes) => {
        secrets.push(bytes.slice())
      })
      return answer(method, params)
    },
  }
  return { agent, calls, secrets }
}

export function session(agent: DesktopAgent): DesktopSession {
  return { agent, frames: new FrameMemory() }
}

export interface AdmitResult {
  readonly width: number
  readonly height: number
}

export function runOf(
  attachment: DesktopSession,
  options: {
    readonly admit?: AdmitResult | string
    readonly caller?: boolean
    readonly botId?: string
  } = {},
): BotConnectorRun<DesktopSession> & { readonly admitted: BotConnectorImageInput[] } {
  const admitted: BotConnectorImageInput[] = []
  const admit = options.admit ?? { width: 1280, height: 1024 }
  return {
    admitted,
    bot: { id: options.botId ?? "b1", name: "Bot" },
    settings: { resolution: "1280x1024" },
    environment: unusedEnvironment(),
    signal: new AbortController().signal,
    trigger: { kind: "call" },
    attachment,
    ...(options.caller === false
      ? {}
      : {
          caller: {
            sessionId: "s1",
            images: {
              async admit(input: BotConnectorImageInput) {
                admitted.push(input)
                if (typeof admit === "string") return { ok: false as const, reason: admit }
                return {
                  ok: true as const,
                  image: {
                    id: "img1",
                    width: admit.width,
                    height: admit.height,
                    source: { width: 1280, height: 1024 },
                  },
                }
              },
            },
          },
        }),
  }
}

export function unusedEnvironment(): BotConnectorEnvironment {
  const fail = async () => {
    throw new Error("the environment is not used here")
  }
  return {
    workspace: "/home/bot/workspace",
    exec: fail,
    spawn: fail,
    readFile: fail,
    writeFile: fail,
  }
}

export function toolsWith(control = new DesktopControl(() => 0)) {
  const list = desktopTools({
    control,
    deadline: (ms) => AbortSignal.timeout(ms),
    now: () => 0,
  })
  const byName = (name: string): BotConnectorToolDefinition<DesktopSession> => {
    const tool = list.find((entry) => entry.name === name)
    if (tool === undefined) throw new Error(`no tool ${name}`)
    return tool
  }
  return { list, byName, control }
}

export async function execute(
  tool: BotConnectorToolDefinition<DesktopSession>,
  args: ConnectorJson,
  run: BotConnectorRun<DesktopSession>,
) {
  return tool.execute(args as never, run)
}

export const WHERE = { active_window: null, focus: null }

export function recordingEnvironment(
  answer: (
    command: BotEnvironmentCommand,
  ) => Partial<BotEnvironmentCommandResult> & { stdoutText?: string },
) {
  const commands: BotEnvironmentCommand[] = []
  const files = new Map<string, Uint8Array>()
  const environment: BotConnectorEnvironment = {
    workspace: "/home/bot/workspace",
    async exec(command) {
      commands.push(command)
      const { stdoutText, ...rest } = answer(command)
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: new TextEncoder().encode(stdoutText ?? ""),
        stdoutTruncated: false,
        stderr: "",
        ...rest,
      }
    },
    async spawn() {
      throw new Error("spawn is answered by the test")
    },
    async readFile() {
      throw new Error("not read")
    },
    async writeFile(path, data) {
      files.set(path, data)
    },
  }
  return { environment, commands, files }
}
