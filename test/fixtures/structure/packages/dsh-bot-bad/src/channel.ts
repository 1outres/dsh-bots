import { type BotChannel, botOf } from "@1outres/dsh-bot-core"

const other: BotChannel = { id: "other" }

export function apply(ctx: never, id: string) {
  botOf(ctx).registerChannel({ id: "discord" })
  botOf(ctx).registerChannel({ id })
  botOf(ctx).registerChannel(other)
}
