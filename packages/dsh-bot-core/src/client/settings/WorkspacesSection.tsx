import { useEffect, useMemo, useState } from "react"
import {
  type BotModelCatalog,
  type BotModelChoice,
  PROFILE_DEFAULT_MODEL,
} from "../../shared/models"
import {
  type BotWorkspaceGrant,
  type BotWorkspaceOptions,
  type BotWorkspaceSettings,
  type BotWorkspaceSettingsChange,
  type DshWorkspace,
  grantsOfBot,
  samePermission,
} from "../../shared/workspaces"
import { useObservable } from "../hooks"
import { IconCheck, IconClose } from "../icons"
import { ModelRoute } from "../models/ModelRoute"
import { type ModelMenu, modelMenu } from "../models/menu"
import { catalogOf, useModelCatalog } from "../models/use-catalog"
import type { Translate } from "../types"
import {
  AddRow,
  BlockRow,
  Button,
  ButtonRow,
  type Choice,
  Code,
  ErrorText,
  Group,
  Row,
  Select,
  StatusPill,
} from "../ui"
import type { WorkspacesClient } from "../workspaces"
import type { SettingsSectionProps } from "./sections"

export interface WorkspacesSectionDeps {
  readonly workspaces: WorkspacesClient
  readCatalog(): Promise<BotModelCatalog>
}

type OptionsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly options: BotWorkspaceOptions }
  | { readonly status: "failed"; readonly message: string }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function useWorkspaceOptions(read: () => Promise<BotWorkspaceOptions>): OptionsState {
  const [state, setState] = useState<OptionsState>({ status: "loading" })
  useEffect(() => {
    let current = true
    read().then(
      (options) => {
        if (current) setState({ status: "ready", options })
      },
      (error: unknown) => {
        if (current) setState({ status: "failed", message: messageOf(error) })
      },
    )
    return () => {
      current = false
    }
  }, [read])
  return state
}

/** One save at a time per grant; a refusal stays on the field it was about. */
function useGrantSave(save: (change: BotWorkspaceSettingsChange) => Promise<void>): {
  readonly busy: boolean
  readonly failure: { readonly field: keyof BotWorkspaceSettings; readonly message: string } | null
  run(field: keyof BotWorkspaceSettings, change: BotWorkspaceSettingsChange): void
} {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{
    readonly field: keyof BotWorkspaceSettings
    readonly message: string
  } | null>(null)
  return {
    busy,
    failure,
    run(field, change) {
      setBusy(true)
      save(change).then(
        () => {
          setBusy(false)
          setFailure(null)
        },
        (error: unknown) => {
          setBusy(false)
          setFailure({ field, message: messageOf(error) })
        },
      )
    },
  }
}

/** The DSH Workspaces the bot's Main session may orchestrate, each saved as it is changed. */
export function WorkspacesSection({
  t,
  bot,
  workspaces,
  readCatalog,
}: SettingsSectionProps & WorkspacesSectionDeps) {
  const snapshot = useObservable(workspaces)
  const options = useWorkspaceOptions(workspaces.options)
  const catalog = useModelCatalog(readCatalog)
  const grants = snapshot === undefined ? [] : grantsOfBot(snapshot, bot.id)
  const stored = useMemo(() => grants.map((grant) => grant.model), [grants])
  const menu = useMemo(() => modelMenu(catalogOf(catalog), stored), [catalog, stored])
  if (snapshot === undefined) {
    return (
      <Group>
        <Row label={t("workspaces.loading")} />
      </Group>
    )
  }
  const workspaceOf = (workspaceId: string) =>
    snapshot.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
  const free = snapshot.workspaces.filter(
    (workspace) => !grants.some((grant) => grant.workspaceId === workspace.workspaceId),
  )
  return (
    <div className="dshb-settings-groups" data-dshb-workspaces="">
      {grants.map((grant) => {
        const workspace = workspaceOf(grant.workspaceId)
        return workspace === undefined ? null : (
          <GrantGroup
            key={grant.workspaceId}
            t={t}
            grant={grant}
            workspace={workspace}
            options={options}
            menu={menu}
            locked={catalogOf(catalog) === undefined}
            workspaces={workspaces}
          />
        )
      })}
      <AddWorkspace t={t} botId={bot.id} free={free} options={options} workspaces={workspaces} />
      {options.status === "failed" && (
        <ErrorText>{t("workspaces.optionsFailed", { message: options.message })}</ErrorText>
      )}
    </div>
  )
}

const presetChoices = (
  t: Translate,
  options: BotWorkspaceOptions | undefined,
  value: string,
): Choice<string>[] => {
  const listed = (options?.agentPresets ?? []).map((preset) => ({
    value: preset.id,
    label: preset.name ?? preset.id,
  }))
  return listed.some((choice) => choice.value === value)
    ? listed
    : [{ value, label: t("workspaces.unlistedValue", { value }) }, ...listed]
}

const knobs = (t: Translate, permission: BotWorkspaceGrant["permission"]) =>
  t("workspaces.permissionKnobs", { sandbox: permission.sandbox, approval: permission.approval })

const permissionChoices = (
  t: Translate,
  options: BotWorkspaceOptions | undefined,
  value: BotWorkspaceGrant["permission"],
): { readonly choices: Choice<string>[]; readonly selected: string } => {
  const listed = options?.permissions ?? []
  const choices = listed.map((option) => ({
    value: option.id,
    label: option.name ?? knobs(t, option.permission),
    title: knobs(t, option.permission),
  }))
  const current = listed.find((option) => samePermission(option.permission, value))
  if (current !== undefined) return { choices, selected: current.id }
  const stored = "stored"
  return {
    choices: [{ value: stored, label: knobs(t, value) }, ...choices],
    selected: stored,
  }
}

interface GrantGroupProps {
  readonly t: Translate
  readonly grant: BotWorkspaceGrant
  readonly workspace: DshWorkspace
  readonly options: OptionsState
  readonly menu: ModelMenu
  readonly locked: boolean
  readonly workspaces: WorkspacesClient
}

function GrantGroup({ t, grant, workspace, options, menu, locked, workspaces }: GrantGroupProps) {
  const save = useGrantSave((change) =>
    workspaces.configure(grant.botId, grant.workspaceId, change),
  )
  const [revoking, setRevoking] = useState<string | null>(null)
  const ready = options.status === "ready" ? options.options : undefined
  const disabled = ready === undefined || save.busy
  const errorOf = (field: keyof BotWorkspaceSettings) =>
    save.failure?.field === field ? save.failure.message : undefined
  const presetLabel = t("workspaces.preset")
  const permissionLabel = t("workspaces.permission")
  const modelLabel = t("workspaces.model")
  const permission = permissionChoices(t, ready, grant.permission)
  const presetListed = ready?.agentPresets.some((preset) => preset.id === grant.agentPreset)
  return (
    <>
      <Group title={workspace.title} marks={{ "data-dshb-workspace-grant": grant.workspaceId }}>
        <Row label={t("workspaces.folder")} trailing={<Code>{workspace.path}</Code>} />
        <Row
          label={presetLabel}
          meta={errorOf("agentPreset")}
          metaTone={errorOf("agentPreset") === undefined ? undefined : "danger"}
          trailing={
            <>
              {ready !== undefined && presetListed === false && (
                <StatusPill tone="warning" label={t("workspaces.unlisted")} />
              )}
              <Select
                value={grant.agentPreset}
                choices={presetChoices(t, ready, grant.agentPreset)}
                onChange={(agentPreset) => save.run("agentPreset", { agentPreset })}
                label={presetLabel}
                disabled={disabled}
                marks={{ "data-dshb-workspace-preset": "" }}
              />
            </>
          }
        />
        <Row
          label={permissionLabel}
          meta={errorOf("permission")}
          metaTone={errorOf("permission") === undefined ? undefined : "danger"}
          trailing={
            <Select
              value={permission.selected}
              choices={permission.choices}
              onChange={(id) => {
                const picked = ready?.permissions.find((option) => option.id === id)
                if (picked !== undefined) save.run("permission", { permission: picked.permission })
              }}
              label={permissionLabel}
              disabled={disabled}
              marks={{ "data-dshb-workspace-permission": "" }}
            />
          }
        />
        <Row
          label={modelLabel}
          meta={errorOf("model")}
          metaTone={errorOf("model") === undefined ? undefined : "danger"}
          trailing={
            <ModelRoute
              t={t}
              menu={menu}
              value={grant.model}
              label={modelLabel}
              disabled={locked || save.busy}
              onChange={(model: BotModelChoice) => save.run("model", { model })}
              marks={{ "data-dshb-workspace-model": "" }}
            />
          }
        />
        <ButtonRow
          label={t("workspaces.remove")}
          tone="danger"
          onClick={() => {
            workspaces.revoke(grant.botId, grant.workspaceId).catch((error: unknown) => {
              setRevoking(messageOf(error))
            })
          }}
          marks={{ "data-dshb-workspace-remove": "" }}
        />
      </Group>
      {revoking !== null && <ErrorText>{revoking}</ErrorText>}
    </>
  )
}

const initialSettings = (options: BotWorkspaceOptions): BotWorkspaceSettings | undefined => {
  const preset = options.agentPresets.find((item) => item.isDefault) ?? options.agentPresets[0]
  const permission = options.permissions.find((item) => item.isDefault) ?? options.permissions[0]
  return preset === undefined || permission === undefined
    ? undefined
    : { agentPreset: preset.id, permission: permission.permission, model: PROFILE_DEFAULT_MODEL }
}

interface AddWorkspaceProps {
  readonly t: Translate
  readonly botId: string
  readonly free: readonly DshWorkspace[]
  readonly options: OptionsState
  readonly workspaces: WorkspacesClient
}

function AddWorkspace({ t, botId, free, options, workspaces }: AddWorkspaceProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const settings = options.status === "ready" ? initialSettings(options.options) : undefined
  const label = t("workspaces.add")
  const picked = free.find((workspace) => workspace.workspaceId === draft)
  return (
    <Group marks={{ "data-dshb-workspace-add-group": "" }}>
      {draft === null || picked === undefined ? (
        <AddRow
          label={label}
          disabled={free.length === 0 || settings === undefined}
          onAdd={() => {
            setFailure(null)
            setDraft(free[0]?.workspaceId ?? null)
          }}
          marks={{ "data-dshb-workspace-add": "" }}
        />
      ) : (
        <BlockRow
          label={label}
          meta={failure ?? undefined}
          metaTone={failure === null ? undefined : "danger"}
          marks={{ "data-dshb-workspace-draft": "" }}
          trailing={
            <>
              <Button
                variant="icon"
                label={t("workspaces.confirm")}
                disabled={busy || settings === undefined}
                onClick={() => {
                  if (settings === undefined) return
                  setBusy(true)
                  workspaces.grant(botId, picked.workspaceId, settings).then(
                    () => {
                      setBusy(false)
                      setDraft(null)
                    },
                    (error: unknown) => {
                      setBusy(false)
                      setFailure(messageOf(error))
                    },
                  )
                }}
                marks={{ "data-dshb-workspace-confirm": "" }}
              >
                <IconCheck size={14} />
              </Button>
              <Button variant="icon" label={t("form.cancel")} onClick={() => setDraft(null)}>
                <IconClose size={14} />
              </Button>
            </>
          }
        >
          <Select
            value={picked.workspaceId}
            choices={free.map((workspace) => ({
              value: workspace.workspaceId,
              label: workspace.title,
              title: workspace.path,
            }))}
            onChange={setDraft}
            label={label}
            disabled={busy}
            marks={{ "data-dshb-workspace-pick": "" }}
          />
        </BlockRow>
      )}
    </Group>
  )
}
