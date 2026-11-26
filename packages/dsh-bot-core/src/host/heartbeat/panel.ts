import {
  type BotHeartbeatView,
  type HeartbeatSettings,
  parseHeartbeatSettings,
} from "../../shared/heartbeat"
import type { Heartbeats } from "./heartbeats"
import type { HeartbeatStore } from "./store"

export interface HeartbeatPanelDeps {
  store: Pick<HeartbeatStore, "get" | "set">
  heartbeats: Pick<Heartbeats, "status">
  exists(botId: string): boolean
}

export interface HeartbeatPanel {
  view(botId: string): BotHeartbeatView
  configure(botId: string, settings: unknown): Promise<BotHeartbeatView>
}

export function createHeartbeatPanel(deps: HeartbeatPanelDeps): HeartbeatPanel {
  const view = (botId: string): BotHeartbeatView => {
    if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
    return { botId, settings: deps.store.get(botId), status: deps.heartbeats.status(botId) }
  }
  return {
    view,
    async configure(botId, input) {
      view(botId)
      const settings: HeartbeatSettings = parseHeartbeatSettings(input)
      await deps.store.set(botId, settings)
      return view(botId)
    },
  }
}
