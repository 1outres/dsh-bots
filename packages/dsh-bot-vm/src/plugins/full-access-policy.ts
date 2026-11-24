/**
 * `@1outres/dsh-bot-vm/full-access-policy`: the `sandboxPolicy` of a bot's
 * execution group. The bot owns its whole VM, so file operations there are
 * never confined or escalated: every resolution is `danger-full-access`,
 * whatever a session's permission preset (`sandbox/mode`) or an explicit
 * mode asks for. It is otherwise `@deepseek-ai/dsh-sandbox-policy`'s
 * service (workspace root, writable-root grants, the `sandbox:policy`
 * prompt context), and must be isolated in the group like the other rows.
 */

import type { BotPermission } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox"
import {
  type Config as SandboxPolicyConfig,
  type SandboxPolicyRequest,
  SandboxPolicyService,
} from "@deepseek-ai/dsh-sandbox-policy"
import z from "@deepseek-ai/schemastery"

export const FULL_ACCESS: BotPermission["sandbox"] = "danger-full-access"

export interface Config {
  /** Fallback root for calls without a session cwd; the bot's directory. */
  workspaceRoot?: string
}

export default class FullAccessSandboxPolicy extends SandboxPolicyService {
  static override Config: z<SandboxPolicyConfig> = z.object({
    workspaceRoot: z.string().description("Fallback workspace root: the bot's directory."),
  }) as z<SandboxPolicyConfig>

  constructor(ctx: Context, config: Config) {
    super(ctx, { workspaceRoot: config.workspaceRoot, mode: FULL_ACCESS })
  }

  override resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    return { ...super.resolve({ ...request, mode: FULL_ACCESS }), mode: FULL_ACCESS }
  }
}
