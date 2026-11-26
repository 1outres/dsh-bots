import { type BotModelChoice, parseModelChoice } from "./models"
import type { ApprovalPolicy, PermissionBundle, SandboxMode } from "./permission"

export interface BotWorkspaceSettings {
  readonly agentPreset: string
  readonly permission: PermissionBundle
  readonly model: BotModelChoice
}

export interface BotWorkspaceGrant extends BotWorkspaceSettings {
  readonly botId: string
  readonly workspaceId: string
  readonly since: number
}

export interface DshWorkspace {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

export interface BotWorkspacesSnapshot {
  readonly grants: readonly BotWorkspaceGrant[]
  readonly workspaces: readonly DshWorkspace[]
}

export interface BotAgentPresetOption {
  readonly id: string
  readonly name?: string
  readonly isDefault: boolean
}

export interface BotPermissionOption {
  readonly id: string
  readonly name?: string
  readonly permission: PermissionBundle
  readonly isDefault: boolean
}

export interface BotWorkspaceOptions {
  readonly agentPresets: readonly BotAgentPresetOption[]
  readonly permissions: readonly BotPermissionOption[]
}

export type BotWorkspaceSettingsChange = {
  readonly [Field in keyof BotWorkspaceSettings]?: BotWorkspaceSettings[Field]
}

export interface BotWorkspacesApi {
  watch(signal?: AbortSignal): AsyncIterable<BotWorkspacesSnapshot>
  options(): Promise<BotWorkspaceOptions>
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
  revoke(botId: string, workspaceId: string): Promise<BotWorkspacesSnapshot>
}

const SANDBOX_MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"]
const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ["ask", "never"]

export const PERMISSION_BUNDLES: readonly PermissionBundle[] = SANDBOX_MODES.flatMap((sandbox) =>
  APPROVAL_POLICIES.map((approval) => ({ sandbox, approval })),
)

export const MAX_AGENT_PRESET_LENGTH = 128

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function onlyKeys(fields: Record<string, unknown>, keys: readonly string[], at: string) {
  const unknown = Object.keys(fields).filter((key) => !keys.includes(key))
  if (unknown.length > 0) throw new Error(`${at} has unknown fields: ${unknown.join(", ")}`)
}

export function parsePermission(value: unknown): PermissionBundle {
  if (!isObject(value)) throw new Error("permission must be an object")
  onlyKeys(value, ["sandbox", "approval"], "permission")
  const { sandbox, approval } = value
  if (!SANDBOX_MODES.includes(sandbox as SandboxMode)) {
    throw new Error(`permission.sandbox must be one of ${SANDBOX_MODES.join(", ")}`)
  }
  if (!APPROVAL_POLICIES.includes(approval as ApprovalPolicy)) {
    throw new Error(`permission.approval must be one of ${APPROVAL_POLICIES.join(", ")}`)
  }
  return { sandbox: sandbox as SandboxMode, approval: approval as ApprovalPolicy }
}

function parseAgentPreset(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_AGENT_PRESET_LENGTH) {
    throw new Error(
      `agentPreset must be a non-empty string of at most ${MAX_AGENT_PRESET_LENGTH} characters`,
    )
  }
  return value
}

const FIELDS = ["agentPreset", "permission", "model"] as const

export function parseWorkspaceSettingsChange(value: unknown): BotWorkspaceSettingsChange {
  if (!isObject(value)) throw new Error("the settings must be an object")
  onlyKeys(value, FIELDS, "the settings")
  return {
    ...(value.agentPreset === undefined
      ? {}
      : { agentPreset: parseAgentPreset(value.agentPreset) }),
    ...(value.permission === undefined ? {} : { permission: parsePermission(value.permission) }),
    ...(value.model === undefined ? {} : { model: parseModelChoice(value.model, "model") }),
  }
}

export function parseWorkspaceSettings(value: unknown): BotWorkspaceSettings {
  const change = parseWorkspaceSettingsChange(value)
  const missing = FIELDS.filter((field) => change[field] === undefined)
  if (missing.length > 0) throw new Error(`the settings lack ${missing.join(", ")}`)
  return change as BotWorkspaceSettings
}

export function samePermission(left: PermissionBundle, right: PermissionBundle): boolean {
  return left.sandbox === right.sandbox && left.approval === right.approval
}

export function grantOf(
  snapshot: BotWorkspacesSnapshot,
  botId: string,
  workspaceId: string,
): BotWorkspaceGrant | undefined {
  return snapshot.grants.find((grant) => grant.botId === botId && grant.workspaceId === workspaceId)
}

export function grantsOfBot(
  snapshot: BotWorkspacesSnapshot,
  botId: string,
): readonly BotWorkspaceGrant[] {
  return snapshot.grants.filter((grant) => grant.botId === botId)
}
