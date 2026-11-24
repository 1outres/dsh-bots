/**
 * The desktop panel's `screen` stream: one viewer of the bot's screen,
 * relayed from Xvnc's socket in the VM through `socat` (bot-core's
 * environment `spawn`). bot-core opens it only for the DSH Host's owner
 * while the desktop is ready for the bot, and ends it when it is not.
 */
import type { BotConnectorStream, BotConnectorStreamDefinition } from "@1outres/dsh-bot-core"
import { parseScreenUp, SCREEN_STREAM, type ScreenUp } from "../../shared/screen"
import type { DesktopControl } from "../control"
import { readVmUser } from "../vm/commands"
import { vncSocket } from "../vm/layout"
import { relay } from "./relay"

export function screenStream(control: DesktopControl): BotConnectorStream {
  const stream: BotConnectorStreamDefinition<ScreenUp> = {
    name: SCREEN_STREAM,
    parse: parseScreenUp,
    async *open(run) {
      const user = await readVmUser(run.environment, run.signal)
      const pipe = await run.environment.spawn({
        argv: ["socat", "-b65536", "-", `UNIX-CONNECT:${vncSocket(user)}`],
        signal: run.signal,
      })
      yield* relay({
        botId: run.bot.id,
        viewer: Symbol(run.bot.id),
        control,
        pipe,
        uplink: run.uplink,
        signal: run.signal,
      })
    },
  }
  return stream
}
