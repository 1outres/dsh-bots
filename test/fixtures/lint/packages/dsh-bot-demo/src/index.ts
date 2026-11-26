import { registry } from "@1outres/dsh-bot-core/src/host/registry"
import type { CredentialProvider } from "@deepseek-ai/dsh-credentials"
import type { ToolsService } from "@deepseek-ai/dsh-tools"

export const inject = ["bot", "sessionController"]
export const values: [unknown, ToolsService | undefined, CredentialProvider | undefined] = [
  registry,
  undefined,
  undefined,
]
export function apply(ctx: { agentPresets: unknown }) {
  return ctx.agentPresets
}
export const secrets = ["credentials"]
