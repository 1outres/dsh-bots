/**
 * The desktop agent as the tools use it: every method's answer checked
 * against its shape (protocol.ts) before anyone reads it.
 */
import {
  type AgentMethod,
  type AgentParams,
  type AgentResult,
  METHOD_TIMEOUT_MS,
  RESULTS,
} from "./protocol"
import type { RpcClient } from "./rpc"

export interface DesktopAgent {
  call<M extends AgentMethod>(
    method: M,
    params: AgentParams[M],
    signal?: AbortSignal,
  ): Promise<AgentResult<M>>
}

export function createDesktopAgent(rpc: RpcClient): DesktopAgent {
  return {
    async call(method, params, signal) {
      const answer = await rpc.call(method, params, {
        timeoutMs: METHOD_TIMEOUT_MS[method],
        ...(signal === undefined ? {} : { signal }),
      })
      return RESULTS[method](answer, method) as AgentResult<typeof method>
    },
  }
}
