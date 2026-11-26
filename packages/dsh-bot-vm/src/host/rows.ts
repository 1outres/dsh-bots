import type { BotEnvironmentBot, PluginRow } from "@1outres/dsh-bot-core"

export const ISOLATED_SERVICES = ["ssh", "fs", "subprocess", "shell", "sandboxPolicy"] as const

export const SSH_PLUGIN = "@1outres/dsh-bot-vm/ssh"
export const POLICY_PLUGIN = "@1outres/dsh-bot-vm/full-access-policy"
export const FS_PLUGIN = "@1outres/dsh-bot-vm/fs"
export const SUBPROCESS_PLUGIN = "@deepseek-ai/dsh-subprocess-ssh"
export const SHELL_PLUGIN = "@deepseek-ai/dsh-bash-local"

export interface RowSettings {
  readonly hostAliasPrefix: string
  readonly workspace: string
  readonly guestNode: string
  readonly helper: string
  readonly helperHash: string
  readonly requestTimeoutMs: number
}

export interface RowContext extends RowSettings {
  readonly sshConfigDir: string
}

export function hostAliasOf(settings: Pick<RowSettings, "hostAliasPrefix">, botId: string) {
  return `${settings.hostAliasPrefix}${botId}`
}

export function environmentRows(
  settings: RowContext,
  bot: BotEnvironmentBot,
): readonly PluginRow[] {
  return [
    {
      id: "env-ssh",
      name: SSH_PLUGIN,
      config: {
        host: hostAliasOf(settings, bot.id),
        configFile: `${settings.sshConfigDir}/${bot.id}.conf`,
        launch: { kind: "node-script", node: settings.guestNode },
        helper: settings.helper,
        helperHash: settings.helperHash,
        workspace: settings.workspace,
        requestTimeoutMs: settings.requestTimeoutMs,
      },
    },
    {
      id: "env-sandbox-policy",
      name: POLICY_PLUGIN,
      config: { workspaceRoot: settings.workspace },
    },
    { id: "env-fs", name: FS_PLUGIN },
    { id: "env-subprocess", name: SUBPROCESS_PLUGIN },
    { id: "env-shell", name: SHELL_PLUGIN, config: { cwd: settings.workspace } },
  ]
}
