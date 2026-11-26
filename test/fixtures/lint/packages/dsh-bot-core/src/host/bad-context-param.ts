import type { Context } from "@deepseek-ai/cordis"

export function start(ctx: Context): void {
  ctx.logger.info("x")
}
export class Holder {
  constructor(private readonly context: Context) {}
}
