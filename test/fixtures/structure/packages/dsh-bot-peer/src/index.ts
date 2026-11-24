import type { Bot } from "@1outres/dsh-bot-core"

export const inject = ["bot"]

export function apply(ctx: { get(name: string): unknown }) {
  ;(ctx.get("bot") as Bot).registerChannel({ id: "peer" })
}
