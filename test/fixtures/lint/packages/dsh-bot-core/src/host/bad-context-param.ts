import type { Context } from "@deepseek-ai/cordis"

export function start(ctx: Context): void { // rule: 13
  ctx.logger.info("x")
}
export class Holder {
  constructor(private readonly context: Context) {} // rule: 13
}
