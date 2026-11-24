import type { Context } from "@deepseek-ai/cordis" // rule: 9
import { join } from "node:path" // rule: 9
import type { BotsState } from "../client/store" // rule: 9
import type { BotRecord } from "../host/domain" // rule: 9
import type { BotView } from "./bots"

export type All = [Context, typeof join, BotsState, BotRecord, BotView]
