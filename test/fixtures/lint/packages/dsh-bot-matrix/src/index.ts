import type { Context } from "@deepseek-ai/cordis"

export function apply(ctx: Context) {
  return [ctx.get("bot"), fetch("https://example.org")]
}
