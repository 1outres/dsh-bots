import { useState } from "react"
import type {
  BotConnectionsSnapshot,
  ConnectionAttemptView,
  ConnectionProviderView,
} from "../../shared/connections"
import type { ConnectionsFeed } from "../connections-model"
import { attemptOf, openSignIn } from "../connections-view"

/** What a sign-in asks the provider for: the services to grant, and the name of a new account. */
export interface SignInRequest {
  readonly services: readonly string[]
  readonly label?: string
  /** Sign this account in again. */
  readonly connectionId?: string
}

export interface SignIn {
  /** The sign-in started last, as the Host reports it. */
  readonly attempt: ConnectionAttemptView | undefined
  /** The provider's page, when the browser refused the tab the sign-in opens. */
  readonly link: string | undefined
  readonly starting: boolean
  /** Open the provider's sign-in in a new tab, within the click; rejects with the Host's refusal. */
  start(request: SignInRequest): Promise<void>
}

/** Signing accounts of one provider in, for a bot (assigned the new account) or for none. */
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
