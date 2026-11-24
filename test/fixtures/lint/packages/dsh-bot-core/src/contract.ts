// botOf is the one name-based service lookup.
import type { Context } from "@deepseek-ai/cordis"

export function botOf(ctx: Context): unknown {
  return ctx.get("bot")
}
