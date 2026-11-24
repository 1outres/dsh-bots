/**
 * The DSH Workspaces a bot's Main session may orchestrate
 * (docs/specs/bot-managed-sessions.md §10): the owner's grant per bot and
 * Workspace, with the Agent preset, the permission and the model of the
 * sessions the Main starts there, and the `botWorkspaces` Remote.
 */
import { type BotModelChoice, parseModelChoice } from "./models"
import type { ApprovalPolicy, PermissionBundle, SandboxMode } from "./permission"

/** How the sessions a bot's Main session starts in one Workspace run; the Main cannot change them. */
export interface BotWorkspaceSettings {
  /** A DSH Agent preset other than any bot's. */
  readonly agentPreset: string
  readonly permission: PermissionBundle
  /** The model when session_start names none (`profile-default`: DSH's default). */
  readonly model: BotModelChoice
}

export interface BotWorkspaceGrant extends BotWorkspaceSettings {
  readonly botId: string
  readonly workspaceId: string
  readonly since: number
}

/** One DSH Workspace (`workspaceRegistry`). */
export interface DshWorkspace {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

/** What the `botWorkspaces` Remote's `watch` streams. */
export interface BotWorkspacesSnapshot {
  /** Every bot's grants, oldest first. */
  readonly grants: readonly BotWorkspaceGrant[]
  /** DSH's Workspaces, in its order. */
  readonly workspaces: readonly DshWorkspace[]
}

export interface BotAgentPresetOption {
  readonly id: string
  readonly name?: string
  readonly isDefault: boolean
}

/** A permission mode: a configured DSH permission preset (or, without dsh-permission-presets, a pair of knobs). */
export interface BotPermissionOption {
  readonly id: string
  readonly name?: string
  readonly permission: PermissionBundle
  readonly isDefault: boolean
}

/** What a grant can choose from now. */
export interface BotWorkspaceOptions {
  /** DSH's Agent presets except the bots'. */
  readonly agentPresets: readonly BotAgentPresetOption[]
  readonly permissions: readonly BotPermissionOption[]
}

export type BotWorkspaceSettingsChange = {
  readonly [Field in keyof BotWorkspaceSettings]?: BotWorkspaceSettings[Field]
}

/** The `botWorkspaces` Remote: the owner grants Workspaces to bots. */
export interface BotWorkspacesApi {
  watch(signal?: AbortSignal): AsyncIterable<BotWorkspacesSnapshot>
  options(): Promise<BotWorkspaceOptions>
  /** @throws when the bot or the Workspace does not exist, it is granted already, or a setting is refused. */
  grant(
    botId: string,
    workspaceId: string,
    settings: BotWorkspaceSettings,
  ): Promise<BotWorkspaceGrant>
  /** Change settings of a grant; sessions already started keep theirs. */
  configure(
    botId: string,
    workspaceId: string,
    change: BotWorkspaceSettingsChange,
  ): Promise<BotWorkspaceGrant>
  /** Withdraw the grant: the bot's management of that Workspace's sessions ends. */
  revoke(botId: string, workspaceId: string): Promise<BotWorkspacesSnapshot>
}

const SANDBOX_MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"]
const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ["ask", "never"]

/** Every pair of knobs, for a DSH without permission presets. */
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

/** A permission (untrusted input). */
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

/** A change of a grant's settings (untrusted input). */
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

/** A grant's complete settings (untrusted input). */
export function parseWorkspaceSettings(value: unknown): BotWorkspaceSettings {
  const change = parseWorkspaceSettingsChange(value)
  const missing = FIELDS.filter((field) => change[field] === undefined)
  if (missing.length > 0) throw new Error(`the settings lack ${missing.join(", ")}`)
  return change as BotWorkspaceSettings
}

export function samePermission(left: PermissionBundle, right: PermissionBundle): boolean {
  return left.sandbox === right.sandbox && left.approval === right.approval
}

/** The bot's grant of a Workspace in a snapshot. */
export function grantOf(
  snapshot: BotWorkspacesSnapshot,
  botId: string,
  workspaceId: string,
): BotWorkspaceGrant | undefined {
  return snapshot.grants.find((grant) => grant.botId === botId && grant.workspaceId === workspaceId)
}

/** The bot's grants in a snapshot, oldest first. */
export function grantsOfBot(
  snapshot: BotWorkspacesSnapshot,
  botId: string,
): readonly BotWorkspaceGrant[] {
  return snapshot.grants.filter((grant) => grant.botId === botId)
}
