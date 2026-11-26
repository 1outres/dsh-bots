import { useState } from "react"
import type {
  BotConnectionsSnapshot,
  ConnectionAttemptView,
  ConnectionProviderView,
} from "../../shared/connections"
import type { ConnectionsFeed } from "../connections-model"
import { attemptOf, openSignIn } from "../connections-view"

export interface SignInRequest {
  readonly services: readonly string[]
  readonly label?: string
  readonly connectionId?: string
}

export interface SignIn {
  readonly attempt: ConnectionAttemptView | undefined
  readonly link: string | undefined
  readonly starting: boolean
  start(request: SignInRequest): Promise<void>
}

export function useSignIn(options: {
  readonly provider: ConnectionProviderView
  readonly connections: Pick<ConnectionsFeed, "authorize">
  readonly snapshot: BotConnectionsSnapshot
  readonly botId?: string
}): SignIn {
  const { provider, connections, snapshot, botId } = options
  const [attemptId, setAttemptId] = useState<string | undefined>(undefined)
  const [link, setLink] = useState<string | undefined>(undefined)
  const [starting, setStarting] = useState(false)
  return {
    attempt: attemptOf(snapshot, attemptId),
    link,
    starting,
    async start(request) {
      setStarting(true)
      setLink(undefined)
      try {
        const opened = await openSignIn(() =>
          connections.authorize({
            provider: provider.id,
            origin: window.location.origin,
            ...(botId === undefined ? {} : { botId }),
            ...request,
          }),
        )
        setAttemptId(opened.attemptId)
        if (!opened.opened) setLink(opened.url)
      } finally {
        setStarting(false)
      }
    },
  }
}
