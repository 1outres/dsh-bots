/**
 * `@1outres/dsh-bot-core/template`: declare a bot template as a Cordis row.
 *
 * ```yaml
 * - id: bot-template-helper
 *   name: '@1outres/dsh-bot-core/template'
 *   config:
 *     id: helper
 *     name: Helper
 *     plugins:
 *       - id: persona
 *         name: '@deepseek-ai/dsh-persona'
 *         config: { prefix: You are a helpful bot. }
 *     hostTools: []
 * ```
 *
 * The row only hands its config to the `bot` service while it is active; the
 * template's rows mount nowhere until a bot's composed preset does.
 */
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, botOf } from "../contract"
import type { BotTemplate } from "../shared/preset"

/**
 * `EntryGroup.key` of `@deepseek-ai/cordis-plugin-loader`, a registered
 * symbol, so this plugin marks itself without depending on the Loader. With
 * it the Loader leaves this row's config uninterpolated: `!!js` nodes in the
 * template's rows reach the composed preset intact and evaluate there, per
 * row, as they do under `@deepseek-ai/dsh-agent-preset`.
 */
export const ENTRY_GROUP: unique symbol = Symbol.for("cordis.group") as never

export type Config = BotTemplate

/** Registers its config as a bot template for as long as the row is active. */
export default class BotTemplateDeclaration {
  static inject = [BOT_SERVICE]
  /** Preserve child expressions until the composed preset mounts them. */
  static readonly [ENTRY_GROUP] = true
  static Config: z<Config> = z.object({
    id: z.string().required().description("Template id: lowercase letters, digits and hyphens."),
    name: z.string().description("Display name."),
    description: z.string().description("One sentence on what bots on this template are for."),
    // Cordis owns each plugin's schema; bot-core validates the row structure.
    plugins: z.array(z.any()).required().description("Preset plugin rows, each with an id."),
    hostTools: z
      .array(z.string())
      .description("Host (global) tools bot Agents may still see, by exact tool name."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    ctx.effect(() => botOf(ctx).registerTemplate(config), `bot-core: template "${config.id}"`)
  }
}
