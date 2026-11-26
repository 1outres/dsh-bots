import type { Context } from "@deepseek-ai/cordis"

export function botOf(ctx: Context): unknown {
  return ctx.get("bot")
}
