import type { BotModelChoice } from "../../shared/models"
import {
  type BotWorkspaceGrant,
  type BotWorkspaceOptions,
  type BotWorkspaceSettings,
  type BotWorkspaceSettingsChange,
  type BotWorkspacesSnapshot,
  type DshWorkspace,
  samePermission,
} from "../../shared/workspaces"
import type { GrantStore } from "./grants-store"

export interface WorkspaceGrantsDeps {
  readonly store: GrantStore
  exists(botId: string): boolean
  workspaces(): readonly DshWorkspace[]
  options(): Promise<BotWorkspaceOptions>
  modelProblem(choice: BotModelChoice): Promise<string | undefined>
  ended(grant: BotWorkspaceGrant, by: "revoked" | "workspace-removed"): Promise<void>
  now(): number
}

export interface WorkspaceGrants {
  snapshot(): BotWorkspacesSnapshot
  get(botId: string, workspaceId: string): BotWorkspaceGrant | undefined
  granted(
    botId: string,
  ): readonly { readonly grant: BotWorkspaceGrant; readonly workspace: DshWorkspace }[]
  grant(
    botId: string,
    workspaceId: string,
    settings: BotWorkspaceSettings,
  ): Promise<BotWorkspaceGrant>
  configure(
    botId: string,
    workspaceId: string,
    change: BotWorkspaceSettingsChange,
  ): Promise<BotWorkspaceGrant>
  revoke(botId: string, workspaceId: string): Promise<void>
  reconcile(): Promise<void>
  purge(exists: (botId: string) => boolean): Promise<void>
  subscribe(listener: () => void): () => void
}

export function createWorkspaceGrants(deps: WorkspaceGrantsDeps): WorkspaceGrants {
  const { store } = deps

  const workspaceOf = (workspaceId: string) =>
    deps.workspaces().find((workspace) => workspace.workspaceId === workspaceId)

  const requireGrant = (botId: string, workspaceId: string) => {
    const grant = store.get(botId, workspaceId)
    if (grant === undefined)
      throw new Error(`Workspace "${workspaceId}" is not granted to this bot`)
    return grant
  }

  const check = async (change: BotWorkspaceSettingsChange) => {
    const options =
      change.agentPreset === undefined && change.permission === undefined
        ? undefined
        : await deps.options()
    if (
      change.agentPreset !== undefined &&
      !options?.agentPresets.some((preset) => preset.id === change.agentPreset)
    ) {
      throw new Error(
        `agentPreset: "${change.agentPreset}" is not an Agent preset a Workspace session can run`,
      )
    }
    const { permission } = change
    if (
      permission !== undefined &&
      !options?.permissions.some((option) => samePermission(option.permission, permission))
    ) {
      throw new Error(
        `permission: sandbox "${permission.sandbox}" with approval "${permission.approval}" is not a permission mode of this DSH`,
      )
    }
    if (change.model !== undefined) {
      const problem = await deps.modelProblem(change.model)
      if (problem !== undefined) throw new Error(`model: ${problem}`)
    }
  }

  const drop = async (keep: (grant: BotWorkspaceGrant) => boolean, notify: boolean) => {
    for (const grant of await store.purge(keep)) {
      if (notify) await deps.ended(grant, "workspace-removed")
    }
  }

  return {
    snapshot: () => ({ grants: store.list(), workspaces: deps.workspaces() }),
    get: (botId, workspaceId) => store.get(botId, workspaceId),
    granted: (botId) =>
      store.list(botId).flatMap((grant) => {
        const workspace = workspaceOf(grant.workspaceId)
        return workspace === undefined ? [] : [{ grant, workspace }]
      }),
    async grant(botId, workspaceId, settings) {
      if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
      if (workspaceOf(workspaceId) === undefined) {
        throw new Error(`Workspace "${workspaceId}" does not exist`)
      }
      if (store.get(botId, workspaceId) !== undefined) {
        throw new Error(`Workspace "${workspaceId}" is already granted to this bot`)
      }
      await check(settings)
      return store.put({ botId, workspaceId, ...settings, since: deps.now() })
    },
    async configure(botId, workspaceId, change) {
      requireGrant(botId, workspaceId)
      await check(change)
      return store.put({ ...requireGrant(botId, workspaceId), ...change })
    },
    async revoke(botId, workspaceId) {
      const grant = requireGrant(botId, workspaceId)
      if (await store.delete(botId, workspaceId)) await deps.ended(grant, "revoked")
    },
    reconcile: () => drop((grant) => workspaceOf(grant.workspaceId) !== undefined, true),
    purge: (exists) => drop((grant) => exists(grant.botId), false),
    subscribe: (listener) => store.subscribe(listener),
  }
}
