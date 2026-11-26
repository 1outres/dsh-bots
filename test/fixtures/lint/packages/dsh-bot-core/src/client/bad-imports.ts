import type { SidebarApi } from "@deepseek-ai/dsh-client-ui-sidebar"
import { join } from "node:path"
import type { BotRecord } from "../host/domain"
import type { BotView } from "../shared/bots"

export type All = [SidebarApi, typeof join, BotRecord, BotView]
