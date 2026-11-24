import { useMemo, useRef, useState } from "react"
import type { BotConnectorView } from "../../shared/connectors"
import { type ConnectorEdit, connectorChange } from "../connector-form"
import type { ConnectorsFeed } from "../connectors-hub"
import { createSerialSaves } from "../serial-saves"
import type { Translate } from "../types"
import { type CommitResult, commitWith } from "../ui/commit"
import { failureText } from "./failure-text"

export interface ConnectorSaves {
  /** Save one change. */
  save(edit: ConnectorEdit): Promise<CommitResult>
  /** The last failed switch or pick, until the next save. */
  readonly error: string | null
  /** Save without waiting, the failure kept in `error` (a switch, a select). */
  pick(edit: ConnectorEdit): void
}

/** One connector's saves, one at a time over what the save before stored. */
export function useConnectorSaves(options: {
  readonly t: Translate
  readonly view: BotConnectorView
  readonly feed: Pick<ConnectorsFeed, "configure">
}): ConnectorSaves {
  const { t, view, feed } = options
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(view)
  latest.current = view
  const connectorId = view.connector.id
  const saves = useMemo(
    () =>
      createSerialSaves<BotConnectorView, ConnectorEdit>({
        current: () => latest.current,
        apply: (stored, edit) => feed.configure(connectorId, connectorChange(stored, edit)),
      }),
    [feed, connectorId],
  )
  const save = async (edit: ConnectorEdit): Promise<CommitResult> => {
    return commitWith(
      () => saves.save(edit),
      (cause) => failureText(t, cause),
    )
  }
  return {
    save,
    error,
    pick(edit) {
      setError(null)
      void save(edit).then((result) => setError(result.ok ? null : result.message))
    },
  }
}
