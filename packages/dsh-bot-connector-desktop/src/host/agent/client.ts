/**
 * The desktop agent as the tools use it: every method's answer checked
 * against its shape (protocol.ts) before anyone reads it.
 */
import type { SecretBytes } from "@1outres/dsh-bot-core"
import {
  type AgentMethod,
  type AgentParams,
  type AgentResult,
  METHOD_TIMEOUT_MS,
  RESULTS,
  type SecretAgentMethod,
  type SecretAgentParams,
} from "./protocol"
import type { RpcClient } from "./rpc"

export interface DesktopAgent {
  call<M extends AgentMethod>(
    method: M,
    params: AgentParams[M],
    signal?: AbortSignal,
  ): Promise<AgentResult<M>>
  /** Hand a secret to the agent with the call; it is wiped once sent (or when the call fails first). */
  callSecret<M extends SecretAgentMethod>(
    method: M,
    params: SecretAgentParams[M],
    secret: SecretBytes,
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
    async callSecret(method, params, secret, signal) {
      const answer = await rpc.callSecret(method, params, secret, {
        timeoutMs: METHOD_TIMEOUT_MS[method],
        ...(signal === undefined ? {} : { signal }),
      })
      return RESULTS[method](answer, method) as AgentResult<typeof method>
    },
  }
}
