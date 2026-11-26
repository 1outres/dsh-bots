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
