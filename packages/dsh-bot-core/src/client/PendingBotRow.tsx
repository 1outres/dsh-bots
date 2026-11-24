import { useState } from "react"
import type { CreationPhase, PendingBotView } from "../shared/bots"
import { Avatar } from "./Avatar"
import type { BotsFace } from "./face"
import { useObservable } from "./hooks"
import type { MessageKey } from "./i18n"
import { IconAlert, IconChevronDown, Spinner } from "./icons"
import { RowError } from "./RowError"
import type { PendingNode } from "./tree"
import type { Translate } from "./types"
import { Button } from "./ui/Button"

export const PHASE_LABELS: { readonly [Phase in CreationPhase]: MessageKey } = {
  queued: "phase.queued",
  creating: "phase.creating",
  booting: "phase.booting",
  connecting: "phase.connecting",
  preset: "phase.preset",
  "starting-main": "phase.starting-main",
}

/** What a pending bot's row says it is doing. */
export function pendingLabel(pending: PendingBotView): MessageKey {
  const { operation, failure } = pending
  if (operation.kind === "remove")
    return failure === undefined ? "pending.removing" : "pending.removeFailed"
  return failure === undefined ? PHASE_LABELS[operation.phase] : "pending.createFailed"
}

interface PendingRowProps
  extends Pick<BotsFace, "pending" | "openProgress" | "status" | "clearError"> {
  readonly t: Translate
  readonly node: PendingNode
  /** Key of the tree's single tab stop. */
  readonly tabKey: string | undefined
  readonly index: number
  readonly count: number
}

/** A bot being created or removed: a faded row with its step, or its failure and what to do about it. */
export function PendingBotRow({ t, node, tabKey, index, count, ...props }: PendingRowProps) {
  const { pending, key, selected } = node
  const [details, setDetails] = useState(false)
  const error = useObservable(props.status)[pending.id]?.error
  const creating = pending.operation.kind === "create"
  const failure = pending.failure
  const label = t(pendingLabel(pending))
  const detailsId = `dshb-pending-${pending.id}-details`
  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles keys for its treeitems */}
      <div
        className="dshb-row dshb-pending-row"
        role="treeitem"
        aria-level={1}
        aria-setsize={count}
        aria-posinset={index + 1}
        aria-selected={selected}
        aria-label={`${pending.name}: ${label}`}
        aria-busy={failure === undefined}
        tabIndex={tabKey === key ? 0 : -1}
        data-dshb-key={key}
        data-dshb-pending={pending.operation.kind}
        data-failed={failure === undefined ? undefined : ""}
        data-selected={selected ? "" : undefined}
        data-inert={creating ? undefined : ""}
        title={`${pending.name}: ${label}`}
        onClick={creating ? () => props.openProgress(pending.id) : undefined}
      >
        <span className="dshb-slot dshb-pending-face">
          <span className="dshb-pending-avatar">
            <Avatar avatar={pending.avatar} size={16} />
          </span>
          <span className="dshb-pending-badge">
            {failure === undefined ? <Spinner size={10} /> : <IconAlert size={10} />}
          </span>
        </span>
        <span className="dshb-title">{pending.name}</span>
        <span className="dshb-pending-label">{label}</span>
      </div>
      {failure !== undefined && (
        <div className="dshb-pending-failure">
          <div className="dshb-pending-actions">
            <Button
              variant="row"
              onClick={() =>
                creating
                  ? props.pending.retryCreate(pending.id)
                  : props.pending.retryRemove(pending.id)
              }
              marks={{ "data-dshb-pending-action": "retry" }}
            >
              {t("pending.retry")}
            </Button>
            <Button
              variant="row"
              tone={creating ? "danger" : undefined}
              onClick={() =>
                creating
                  ? props.pending.discardCreate(pending.id)
                  : props.pending.dismissRemove(pending.id)
              }
              marks={{ "data-dshb-pending-action": creating ? "discard" : "dismiss" }}
            >
              {t(creating ? "pending.discard" : "pending.dismiss")}
            </Button>
            <Button
              variant="icon"
              label={t(details ? "pending.hideDetails" : "pending.details")}
              expanded={details}
              controls={detailsId}
              onClick={() => setDetails(!details)}
              marks={{ "data-dshb-pending-action": "details" }}
            >
              <IconChevronDown size={14} />
            </Button>
          </div>
          {details && (
            <p className="dshb-pending-message" id={detailsId}>
              {failure.message}
            </p>
          )}
        </div>
      )}
      {error !== undefined && (
        <RowError t={t} message={error} onDismiss={() => props.clearError(pending.id)} />
      )}
    </>
  )
}
