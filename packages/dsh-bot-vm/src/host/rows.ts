import type { BotEnvironmentBot, PluginRow } from "@1outres/dsh-bot-core"

/** Service names the environment rows provide; bot-core isolates each in the bot's group. */
export const ISOLATED_SERVICES = ["ssh", "fs", "subprocess", "shell", "sandboxPolicy"] as const

export const SSH_PLUGIN = "@1outres/dsh-bot-vm/ssh"
export const POLICY_PLUGIN = "@1outres/dsh-bot-vm/full-access-policy"
export const FS_PLUGIN = "@1outres/dsh-bot-vm/fs"
export const SUBPROCESS_PLUGIN = "@deepseek-ai/dsh-subprocess-ssh"
export const SHELL_PLUGIN = "@deepseek-ai/dsh-bash-local"

export interface RowSettings {
  /** Prefix of the per-bot SSH host alias; the alias is `<prefix><botId>`. */
  readonly hostAliasPrefix: string
  /** Absolute guest directory that is the cwd of every bot session. */
  readonly workspace: string
  /** Absolute guest Node executable that runs the helper. */
  readonly guestNode: string
  /** Absolute guest path of dsh-ssh's lib/helper.js. */
  readonly helper: string
  /** SHA-256 of that helper.js. */
  readonly helperHash: string
  readonly requestTimeoutMs: number
}

export function hostAliasOf(settings: Pick<RowSettings, "hostAliasPrefix">, botId: string) {
  return `${settings.hostAliasPrefix}${botId}`
}

/** The bot's execution rows: SSH connection, policy, then the SSH-backed providers. */
export function environmentRows(
  settings: RowSettings,
  bot: BotEnvironmentBot,
): readonly PluginRow[] {
  return [
    {
      id: "env-ssh",
      name: SSH_PLUGIN,
      config: {
        host: hostAliasOf(settings, bot.id),
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
