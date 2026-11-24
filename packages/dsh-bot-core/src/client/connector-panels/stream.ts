import type { ConnectorPanelStream } from "../../connector-panel-contract"
import type { ConnectorJson } from "../../shared/connectors"
import type { RemoteMount } from "../remote"
import type { DuplexStreamHandle } from "../types"

/**
 * A panel stream over `remote.botConnectorStreams.open`, usable at once: items
 * sent before bot-core's Remote is mounted wait for it, and disposing first
 * never opens it.
 */
export function openConnectorStream(
  mount: Promise<RemoteMount>,
  botId: string,
  connectorId: string,
  name: string,
): ConnectorPanelStream {
  let handle: DuplexStreamHandle<ConnectorJson, ConnectorJson> | undefined
  let disposed = false
  let ended = false
  const queued: ConnectorJson[] = []
  const opened = mount.then((mounted) => {
    if (mounted.status === "failed") throw new Error(mounted.error)
    if (disposed) return undefined
    handle = mounted.remote.botConnectorStreams.open(botId, connectorId, name)
    for (const item of queued.splice(0)) handle.send(item)
    if (ended) handle.end()
    return handle
  })
  return {
    send(item) {
      if (disposed || ended) throw new Error("the stream is closed")
      if (handle === undefined) queued.push(item)
      else handle.send(item)
    },
    end() {
      if (ended) return
      ended = true
      handle?.end()
    },
    dispose() {
      disposed = true
      handle?.dispose()
    },
    async *[Symbol.asyncIterator]() {
      const current = await opened
      if (current === undefined) return
      yield* current
    },
  }
}
