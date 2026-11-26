import type { Context } from "@deepseek-ai/cordis"
import { join } from "node:path"
import type { BotsState } from "../client/store"
import type { BotRecord } from "../host/domain"
import type { BotView } from "./bots"

export type All = [Context, typeof join, BotsState, BotRecord, BotView]
