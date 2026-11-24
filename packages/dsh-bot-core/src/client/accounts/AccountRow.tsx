import { useEffect, useRef, useState } from "react"
import {
  type ConnectionStatus,
  type ConnectionView,
  MAX_CONNECTION_LABEL,
} from "../../shared/connections"
import type { MessageKey } from "../i18n"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { type CommitResult, Row, RowMenu, StatusPill, Switch, TextField, useTextDraft } from "../ui"
import { useLayer } from "../ui/layers"
import type { PillTone } from "../ui/StatusPill"

const STATUS: Readonly<
  Record<ConnectionStatus, { readonly tone: PillTone; readonly label: MessageKey }>
> = {
  active: { tone: "success", label: "connections.status.active" },
  "needs-reauth": { tone: "warning", label: "connections.status.needs-reauth" },
  revoked: { tone: "warning", label: "connections.status.revoked" },
  error: { tone: "danger", label: "connections.status.error" },
}

export interface AccountRowProps {
  readonly t: Translate
  readonly connection: ConnectionView
  /** A bot's side: whether the bot uses the account, and the switch that changes it. */
  readonly assignment?: { readonly assigned: boolean; onChange(assigned: boolean): void }
  readonly busy: boolean
  rename(label: string): Promise<CommitResult>
  signInAgain(): void
  disconnect(): void
}

/** One connected account: its letter, name and email, the bots using it, its state and its `…` menu. */
export function AccountRow(props: AccountRowProps) {
  const { t, connection, assignment, busy } = props
  const [renaming, setRenaming] = useState(false)
  const status = STATUS[connection.status]
  const email = connection.account.email
  const meta = [
    email !== undefined && email.toLowerCase() !== connection.label.toLowerCase()
      ? email
      : undefined,
    localeFormat(t).count("connections.bots", connection.bots.length),
  ]
    .filter((part) => part !== undefined)
    .join(" · ")
  return (
    <Row
      label={connection.label}
      meta={meta}
      description={connection.status === "active" ? undefined : connection.statusReason}
      leading={
        <span className="dshb-account-letter" aria-hidden="true">
          {[...connection.label][0]?.toUpperCase()}
        </span>
      }
      marks={{
        "data-dshb-account": connection.account.email ?? connection.id,
        "data-status": connection.status,
      }}
      trailing={
        renaming ? (
          <RenameField
            t={t}
            label={connection.label}
            rename={props.rename}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <>
            <StatusPill tone={status.tone} label={t(status.label)} />
            {assignment !== undefined && (
              <Switch
                checked={assignment.assigned}
                label={t("connections.assigned", { account: connection.label })}
                disabled={busy}
                onChange={assignment.onChange}
                marks={{ "data-dshb-account-assign": "" }}
              />
            )}
            <RowMenu
              label={t("connections.menu", { account: connection.label })}
              disabled={busy}
              marks={{ "data-dshb-account-menu": "" }}
              items={[
                { id: "rename", label: t("connections.rename"), run: () => setRenaming(true) },
                { id: "reconnect", label: t("connections.reconnect"), run: props.signInAgain },
                {
                  id: "disconnect",
                  label: t("connections.disconnect"),
                  tone: "danger",
                  run: props.disconnect,
                },
              ]}
            />
          </>
        )
      }
    />
  )
}

function RenameField(props: {
  readonly t: Translate
  readonly label: string
  rename(label: string): Promise<CommitResult>
  onDone(): void
}) {
  const { t, onDone } = props
  const wrapRef = useRef<HTMLSpanElement>(null)
  const draft = useTextDraft({
    value: props.label,
    validate: (text) => (text.trim() === "" ? t("connections.rename.empty") : null),
    commit: async (text) => {
      const result = await props.rename(text.trim())
      if (result.ok) onDone()
      return result
    },
  })
  useLayer(wrapRef, { active: true, trap: false, onEscape: onDone })
  const latest = useRef({ draft, onDone })
  latest.current = { draft, onDone }
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    wrap.querySelector("input")?.focus()
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && wrap.contains(event.relatedTarget)) return
      const { draft: shown, onDone: done } = latest.current
      if (!shown.editing && !shown.busy) done()
    }
    wrap.addEventListener("focusout", onFocusOut)
    return () => wrap.removeEventListener("focusout", onFocusOut)
  }, [])
  return (
    <span ref={wrapRef} className="dshb-account-rename">
      <TextField
        draft={draft}
        label={t("connections.rename.label", { account: props.label })}
        maxLength={MAX_CONNECTION_LABEL}
        marks={{ "data-dshb-account-rename": "" }}
      />
    </span>
  )
}
