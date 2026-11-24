import { useState } from "react"
import {
  type BotConnectorView,
  CONNECTOR_PERMISSIONS,
  type ConnectorPermission,
  type ConnectorPermissionChange,
} from "../../shared/connectors"
import {
  accountChange,
  accountLoosening,
  type ConnectorAccountRow,
  type ConnectorToolRow,
  filterTools,
  looseningOf,
  permissionChange,
  resetChange,
  resetChanges,
  TOOLS_FILTER_FROM,
  toolRows,
} from "../connector-tools"
import type { ConnectorsFeed } from "../connectors-hub"
import type { MessageKey } from "../i18n"
import { IconRefresh, IconSearch } from "../icons"
import type { Translate } from "../types"
import { Button, Group, Row, Segmented, Tag } from "../ui"
import { AccountExceptions } from "./AccountExceptions"
import { failureText } from "./failure-text"
import { PERMISSION_LABEL } from "./permission-label"
import type { SettingsSectionProps } from "./sections"

const LOOSENING_TEXT: Readonly<Record<"ask" | "disallow", MessageKey>> = {
  ask: "connectors.confirm.allow.ask",
  disallow: "connectors.confirm.allow.disallow",
}

interface ConnectorToolsProps {
  readonly t: Translate
  readonly view: BotConnectorView
  readonly feed: Pick<ConnectorsFeed, "setPermission">
  readonly confirm: SettingsSectionProps["confirm"]
}

/**
 * The bot's permission of each tool of a connector, then the accounts'
 * exceptions. A change is saved at once; letting a tool run without
 * asking against its default asks first.
 */
export function ConnectorTools({ t, view, feed, confirm }: ConnectorToolsProps) {
  const rows = toolRows(view)
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const shown = filterTools(rows, query)
  const overridden = resetChanges(rows)

  const apply = async (changes: readonly ConnectorPermissionChange[]) => {
    const keys = changes.map((change) => change.tool)
    setPending((current) => [...current, ...keys])
    setError(null)
    try {
      for (const change of changes) await feed.setPermission(change)
    } catch (cause) {
      setError(failureText(t, cause))
    } finally {
      setPending((current) => current.filter((tool) => !keys.includes(tool)))
    }
  }

  const change = async (
    row: ConnectorToolRow,
    next: ConnectorPermissionChange | undefined,
    account?: ConnectorAccountRow,
  ) => {
    if (next === undefined) return
    const loosening =
      account === undefined ? looseningOf(row, next) : accountLoosening(row, account, next)
    if (loosening !== undefined) {
      const confirmed = await confirm({
        title: t("connectors.confirm.allow.title", { tool: row.tool.name }),
        description: t(LOOSENING_TEXT[loosening]),
        confirm: t("connectors.confirm.allow.accept"),
        tone: "danger",
      })
      if (!confirmed) return
    }
    await apply([next])
  }

  const choices = CONNECTOR_PERMISSIONS.map((permission) => ({
    value: permission,
    label: t(PERMISSION_LABEL[permission]),
  }))

  return (
    <>
      <Group
        title={t("connectors.tools.title", { count: rows.length })}
        aside={
          <span className="dshb-tools-bar">
            {rows.length >= TOOLS_FILTER_FROM && (
              <span className="dshb-ui-field dshb-tools-filter">
                <IconSearch size={14} />
                <input
                  className="dshb-ui-field-input"
                  type="search"
                  placeholder={t("connectors.tools.filter")}
                  aria-label={t("connectors.tools.filter")}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  data-dshb-connector-tools-filter=""
                />
              </span>
            )}
            {overridden.length > 0 && (
              <Button
                variant="row"
                disabled={pending.length > 0}
                onClick={() => void apply(overridden)}
                marks={{ "data-dshb-connector-reset-all": "" }}
              >
                {t("connectors.tools.resetAll", { count: overridden.length })}
              </Button>
            )}
          </span>
        }
        marks={{ "data-dshb-connector-tools": "" }}
      >
        {error !== null && <Row label={error} metaTone="danger" />}
        {shown.length === 0 ? (
          <Row label={t("connectors.tools.noMatch")} density="compact" />
        ) : (
          shown.map((row) => (
            <ToolRow
              key={row.tool.name}
              t={t}
              row={row}
              choices={choices}
              busy={pending.includes(row.tool.name)}
              onPick={(next) => void change(row, permissionChange(row, next))}
              onReset={() => void change(row, resetChange(row))}
            />
          ))
        )}
      </Group>
      <AccountExceptions
        t={t}
        rows={rows}
        choices={choices}
        pending={pending}
        onChange={(row, account, next) => change(row, accountChange(row, account, next), account)}
      />
    </>
  )
}

interface ToolRowProps {
  readonly t: Translate
  readonly row: ConnectorToolRow
  readonly choices: readonly { readonly value: ConnectorPermission; readonly label: string }[]
  readonly busy: boolean
  onPick(next: ConnectorPermission): void
  onReset(): void
}

function ToolRow({ t, row, choices, busy, onPick, onReset }: ToolRowProps) {
  const overridden = row.override !== undefined
  return (
    <Row
      label={row.tool.name}
      description={row.tool.description}
      density="compact"
      marks={{
        "data-dshb-connector-tool": row.tool.toolName,
        "data-effective": row.effective,
        ...(overridden ? { "data-overridden": "" } : {}),
      }}
      trailing={
        <>
          {overridden && (
            <>
              <Tag>{t("connectors.tools.overridden")}</Tag>
              <Button
                variant="icon"
                label={t("connectors.tools.reset", {
                  permission: t(PERMISSION_LABEL[row.default]),
                })}
                disabled={busy}
                onClick={onReset}
                marks={{ "data-dshb-connector-tool-reset": "" }}
              >
                <IconRefresh size={14} />
              </Button>
            </>
          )}
          <Segmented
            value={row.effective}
            choices={choices.map((choice) =>
              choice.value === row.default
                ? { ...choice, title: t("connectors.permission.default") }
                : choice,
            )}
            label={row.tool.name}
            disabled={busy}
            onChange={onPick}
            marks={{ "data-dshb-connector-tool-permission": row.tool.toolName }}
          />
        </>
      }
    />
  )
}
