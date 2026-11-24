import { BOT_SERVICE, botOf } from "@1outres/dsh-bot-core"

export const inject = [BOT_SERVICE]

export function apply(ctx: never) {
  botOf(ctx).registerChannel({ id: "good" })
}
