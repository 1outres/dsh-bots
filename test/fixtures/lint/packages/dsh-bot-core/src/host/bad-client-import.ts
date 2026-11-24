import type { BotsState } from "../client/store" // rule: 11
import type { BotView } from "../shared/bots"

export type State = [BotsState, BotView]
