import type { Context } from "@deepseek-ai/cordis"
import type { PostToolDecision } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import { postDecision, preDecision } from "../host/vaults/guard-decision"
import {
  GUARD_TOOL_ARGUMENTS,
  GUARD_TOOL_RESULT,
  type GuardToolArguments,
  type GuardToolResult,
} from "../internal"

export interface Config {
  botId: string
  token: string
}

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot guard a bot's secrets`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

const NO_AGENT: PostToolDecision = {
  kind: "block",
  feedback: [
    { type: "text", text: "Error: a call without its Agent cannot be checked by the vault guard." },
  ],
  info: { name: "VaultGuard", code: "VAULT_GUARD_FAILED" },
}

export default class BotVaultGuard {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const checkArguments = methodOf<GuardToolArguments>(bot, GUARD_TOOL_ARGUMENTS)
    const checkResult = methodOf<GuardToolResult>(bot, GUARD_TOOL_RESULT)
    ctx.on(
      "tools/pre-execute",
      async (exec, next) => {
        if (exec.agent === undefined) {
          return {
            kind: "deny",
            reason: "a call without its Agent cannot be checked by the vault guard",
          }
        }
        const verdict = await checkArguments(config.botId, config.token, {
          agentId: exec.agent.id,
          tool: exec.name,
          args: exec.arguments,
        })
        return preDecision(verdict) ?? next()
      },
      { prepend: true },
    )
    ctx.on(
      "tools/post-execute",
      async (exec, result, next) => {
        const decision = await next()
        if (exec.agent === undefined) return NO_AGENT
        const verdict = await checkResult(config.botId, config.token, {
          agentId: exec.agent.id,
          tool: exec.name,
          result,
          decision,
        })
        return postDecision(verdict, result, decision)
      },
      { prepend: true },
    )
  }
}
