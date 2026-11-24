/**
 * `@1outres/dsh-bot-core/prompt`: bot-core's own row inside every bot's
 * isolated `bot-environment` group (compose.ts puts it after the schedule
 * row; templates and overlays cannot name it). For the bot's Agents it
 * registers bot-core's prompt sections, the `bot:status` and `bot:management` contexts and the
 * `{{bot_name}}` variable (docs/specs/bot-system-prompt.md), each worded from
 * what the `bot` service tells about the assembling Agent, and takes
 * {@link BOT_PROMPT_EXCLUSIONS} out of their prompt.
 *
 * Registrations and the `system-prompt/assemble` listener of this row carry
 * the scope of the preset revision it is mounted in, so DSH applies them only
 * to assemblies of Agents bound to that revision (their scope's parent).
 */
import type { Context } from "@deepseek-ai/cordis"
import type { AssembleContext } from "@deepseek-ai/dsh-system-prompt"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, botOf } from "../contract"
import { agentIdOf } from "../host/prompt/assembly"
import { withoutExcluded } from "../host/prompt/exclusions"
import {
  BOT_MANAGEMENT_CONTEXT,
  BOT_NAME_VARIABLE,
  BOT_PROMPT_SECTIONS,
  BOT_STATUS_CONTEXT,
  type BotPromptPart,
} from "../host/prompt/sections"
import { type BotPromptFacts, DESCRIBE_PROMPT, type DescribePrompt } from "../internal"
import { BOT_PROMPT_EXCLUSIONS } from "../shared/prompt"

export interface Config {
  botId: string
  /** The preset revision's token (compose.ts), as every bot-core row carries it. */
  token: string
}

export default class BotPrompt {
  static inject = [BOT_SERVICE, "systemPrompt"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const method: unknown = Reflect.get(bot, DESCRIBE_PROMPT)
    if (typeof method !== "function") {
      throw new Error(`the "${BOT_SERVICE}" service cannot describe a bot's prompt`)
    }
    const describe = (method as DescribePrompt).bind(bot)
    // One answer per assembly, so every part of it reads the same facts.
    const assemblies = new WeakMap<AssembleContext, BotPromptFacts>()
    const factsOf = (context: AssembleContext): BotPromptFacts => {
      const known = assemblies.get(context)
      if (known !== undefined) return known
      const facts = describe(config.botId, config.token, agentIdOf(context))
      assemblies.set(context, facts)
      return facts
    }
    const textOf = (part: BotPromptPart) => (context: AssembleContext) =>
      part.text(factsOf(context))

    ctx.systemPrompt.variable(BOT_NAME_VARIABLE, (context) => factsOf(context).botName)
    for (const part of BOT_PROMPT_SECTIONS) {
      ctx.systemPrompt.section({
        name: part.name,
        order: part.order,
        interpolate: false,
        text: textOf(part),
      })
    }
    for (const part of [BOT_STATUS_CONTEXT, BOT_MANAGEMENT_CONTEXT]) {
      ctx.systemPrompt.context({
        name: part.name,
        order: part.order,
        interpolate: false,
        text: textOf(part),
      })
    }
    ctx.on("system-prompt/assemble", async (_assembly, _context, next) =>
      withoutExcluded(await next(), BOT_PROMPT_EXCLUSIONS),
    )
  }
}
