export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"

export type ApprovalPolicy = "ask" | "never"

export interface PermissionBundle {
  readonly sandbox: SandboxMode
  readonly approval: ApprovalPolicy
}

export interface BotPermission extends PermissionBundle {
  readonly sandbox: "danger-full-access"
  readonly approval: "never"
}

export const BOT_PERMISSION: BotPermission = { sandbox: "danger-full-access", approval: "never" }
