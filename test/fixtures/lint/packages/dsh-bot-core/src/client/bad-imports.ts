import type { SidebarApi } from "@deepseek-ai/dsh-client-ui-sidebar" // rule: 30
import { join } from "node:path" // rule: 10
import type { BotRecord } from "../host/domain" // rule: 10
import type { BotView } from "../shared/bots"

export type All = [SidebarApi, typeof join, BotRecord, BotView]
