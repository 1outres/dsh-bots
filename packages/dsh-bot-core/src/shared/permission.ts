/**
 * The permission every bot session runs under. bot-core sets it on each bot
 * Agent's session, whatever the profile's permission defaults are: a bot owns
 * its whole environment, so nothing it does there is confined or asks a person
 * for approval.
 */

/** DSH's sandbox modes (dsh-sandbox `SandboxMode`). */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"

/** DSH's approval policies (dsh-user-approval `ApprovalPolicy`). */
export type ApprovalPolicy = "ask" | "never"

/** A sandbox mode and an approval policy, as a session records them. */
export interface PermissionBundle {
  readonly sandbox: SandboxMode
  readonly approval: ApprovalPolicy
}

/** The bundle of every bot session. */
export interface BotPermission extends PermissionBundle {
  readonly sandbox: "danger-full-access"
  readonly approval: "never"
}

export const BOT_PERMISSION: BotPermission = { sandbox: "danger-full-access", approval: "never" }
