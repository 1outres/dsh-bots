import { type IShardingStrategy, SimpleShardingStrategy, type WebSocketOptions } from "discord.js"

type GatewayManager = Parameters<NonNullable<WebSocketOptions["buildStrategy"]>>[0]

export function stoppableSharding(
  manager: GatewayManager,
  stopped: () => boolean,
): IShardingStrategy {
  const shards = new SimpleShardingStrategy(manager)
  return {
    async spawn(shardIds) {
      if (!stopped()) await shards.spawn(shardIds)
    },
    async connect() {
      if (!stopped()) await shards.connect()
    },
    destroy: (options) => shards.destroy(options),
    send: (shardId, payload) => shards.send(shardId, payload),
    fetchStatus: () => shards.fetchStatus(),
  }
}
