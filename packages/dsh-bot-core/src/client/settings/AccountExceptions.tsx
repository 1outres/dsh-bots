import { useState } from "react"
import type { ConnectorPermission } from "../../shared/connectors"
import {
  type AccountException,
  accountChange,
  accountExceptions,
  accountOf,
  type ConnectorAccountRow,
  type ConnectorToolRow,
  connectorAccounts,
  exceptionCandidates,
} from "../connector-tools"
import { IconClose, IconRefresh } from "../icons"
import type { Translate } from "../types"
import { AddRow, BlockRow, Button, type Choice, Group, Row, Segmented, Select } from "../ui"
import { PERMISSION_LABEL } from "./permission-label"

export interface AccountExceptionsProps {
  readonly t: Translate
  readonly rows: readonly ConnectorToolRow[]
  readonly choices: readonly Choice<ConnectorPermission>[]
  readonly pending: readonly string[]
  /** Saves the account's permission of the tool; `null` follows the tool's. */
  onChange(
    row: ConnectorToolRow,
    account: ConnectorAccountRow,
    next: ConnectorPermission | null,
  ): Promise<void>
}

interface Draft {
  readonly connectionId: string
  readonly tool: string
}

/**
 * The tools whose permission as an account differs from the tool's, and a
 * row that adds one: pick the account and the tool, then the permission,
 * which saves it.
 */
export function AccountExceptions({ t, rows, choices, pending, onChange }: AccountExceptionsProps) {
  const accounts = connectorAccounts(rows)
  const [draft, setDraft] = useState<Draft | null>(null)
  if (accounts.length === 0) return null
  const exceptions = accountExceptions(rows)

  const draftFor = (connectionId: string, tool?: string): Draft | null => {
    const candidates = exceptionCandidates(rows, connectionId)
    const picked = candidates.find((row) => row.tool.name === tool) ?? candidates[0]
    return picked === undefined ? null : { connectionId, tool: picked.tool.name }
  }
  const firstDraft = () =>
    accounts.reduce<Draft | null>((found, account) => found ?? draftFor(account.connectionId), null)
  const canAdd = firstDraft() !== null

  return (
    <Group title={t("connectors.tools.perAccount")} marks={{ "data-dshb-tool-exceptions": "" }}>
      {exceptions.map((exception) => (
        <ExceptionRow
          key={`${exception.account.connectionId}:${exception.row.tool.name}`}
          t={t}
          exception={exception}
          choices={choices}
          busy={pending.includes(exception.row.tool.name)}
          onChange={(next) => onChange(exception.row, exception.account, next)}
        />
      ))}
      {draft === null ? (
        <AddRow
          label={t("connectors.tools.exceptionAdd")}
          disabled={!canAdd}
          onAdd={() => setDraft(firstDraft())}
          marks={{ "data-dshb-tool-exception-add": "" }}
        />
      ) : (
        <DraftRow
          t={t}
          rows={rows}
          accounts={accounts}
          draft={draft}
          choices={choices}
          busy={pending.includes(draft.tool)}
          onDraft={(connectionId, tool) => setDraft(draftFor(connectionId, tool))}
          onCancel={() => setDraft(null)}
          onPick={(row, account, next) =>
            void onChange(row, account, next).then(() => setDraft(null))
          }
        />
      )}
    </Group>
  )
}

function ExceptionRow({
  t,
  exception,
  choices,
  busy,
  onChange,
}: {
  readonly t: Translate
  readonly exception: AccountException
  readonly choices: readonly Choice<ConnectorPermission>[]
  readonly busy: boolean
  onChange(next: ConnectorPermission | null): Promise<void>
}) {
  const { row, account } = exception
  return (
    <Row
      label={row.tool.name}
      meta={account.name}
      description={row.tool.description}
      density="compact"
      marks={{ "data-dshb-tool-exception": `${account.name}:${row.tool.toolName}` }}
      trailing={
        <>
          <Button
            variant="icon"
            label={t("connectors.tools.reset", { permission: t(PERMISSION_LABEL[row.effective]) })}
            disabled={busy}
            onClick={() => void onChange(null)}
            marks={{ "data-dshb-tool-exception-reset": "" }}
          >
            <IconRefresh size={14} />
          </Button>
          <Segmented
            value={account.effective}
            choices={choices}
            label={`${row.tool.name} · ${account.name}`}
            disabled={busy}
            onChange={(next) => void onChange(next)}
          />
        </>
      }
    />
  )
}

function DraftRow({
  t,
  rows,
  accounts,
  draft,
  choices,
  busy,
  onDraft,
  onCancel,
  onPick,
}: {
  readonly t: Translate
  readonly rows: readonly ConnectorToolRow[]
  readonly accounts: readonly ConnectorAccountRow[]
  readonly draft: Draft
  readonly choices: readonly Choice<ConnectorPermission>[]
  readonly busy: boolean
  onDraft(connectionId: string, tool?: string): void
  onCancel(): void
  onPick(row: ConnectorToolRow, account: ConnectorAccountRow, next: ConnectorPermission): void
}) {
  const row = rows.find((candidate) => candidate.tool.name === draft.tool)
  const account = row === undefined ? undefined : accountOf(row, draft.connectionId)
  if (row === undefined || account === undefined) return null
  const open = accounts.filter(
    (candidate) => exceptionCandidates(rows, candidate.connectionId).length > 0,
  )
  return (
    <BlockRow
      label={t("connectors.tools.exceptionAdd")}
      marks={{ "data-dshb-tool-exception-draft": "" }}
      trailing={
        <Button variant="icon" label={t("form.cancel")} onClick={onCancel}>
          <IconClose size={14} />
        </Button>
      }
    >
      <div className="dshb-tools-exception-draft">
        <Select
          value={draft.connectionId}
          choices={open.map((candidate) => ({
            value: candidate.connectionId,
            label: candidate.name,
          }))}
          label={t("connectors.tools.account")}
          disabled={busy}
          onChange={(connectionId) => onDraft(connectionId, draft.tool)}
          marks={{ "data-dshb-tool-exception-account": "" }}
        />
        <Select
          value={draft.tool}
          choices={exceptionCandidates(rows, draft.connectionId).map((candidate) => ({
            value: candidate.tool.name,
            label: candidate.tool.name,
          }))}
          label={t("connectors.tools.tool")}
          disabled={busy}
          onChange={(tool) => onDraft(draft.connectionId, tool)}
          marks={{ "data-dshb-tool-exception-tool": "" }}
        />
        <Segmented
          value={account.effective}
          choices={choices}
          label={`${row.tool.name} · ${account.name}`}
          disabled={busy}
          onChange={(next) => {
            if (next !== account.effective && accountChange(row, account, next) !== undefined) {
              onPick(row, account, next)
            }
          }}
          marks={{ "data-dshb-tool-exception-permission": "" }}
        />
      </div>
    </BlockRow>
  )
}
