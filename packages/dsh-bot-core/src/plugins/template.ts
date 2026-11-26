import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, botOf } from "../contract"
import type { BotTemplate } from "../shared/preset"

export const ENTRY_GROUP: unique symbol = Symbol.for("cordis.group") as never

export type Config = BotTemplate

export default class BotTemplateDeclaration {
  static inject = [BOT_SERVICE]
  static readonly [ENTRY_GROUP] = true
  static Config: z<Config> = z.object({
    id: z.string().required().description("Template id: lowercase letters, digits and hyphens."),
    name: z.string().description("Display name."),
    description: z.string().description("One sentence on what bots on this template are for."),
    plugins: z.array(z.any()).required().description("Preset plugin rows, each with an id."),
    hostTools: z
      .array(z.string())
      .description("Host (global) tools bot Agents may still see, by exact tool name."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    ctx.effect(() => botOf(ctx).registerTemplate(config), `bot-core: template "${config.id}"`)
  }
}
