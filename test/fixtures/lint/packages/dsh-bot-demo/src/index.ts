import { registry } from "@1outres/dsh-bot-core/src/host/registry" // rule: 15
import type { CredentialProvider } from "@deepseek-ai/dsh-credentials" // rule: 16
import type { ToolsService } from "@deepseek-ai/dsh-tools" // rule: 16

export const inject = ["bot", "sessionController"] // rule: 17
export const values: [unknown, ToolsService | undefined, CredentialProvider | undefined] = [
  registry,
  undefined,
  undefined,
]
export function apply(ctx: { agentPresets: unknown }) { // rule: 17
  return ctx.agentPresets // rule: 17
}
export const secrets = ["credentials"] // rule: 17
