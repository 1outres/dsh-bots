/**
 * `@1outres/dsh-bot-vm/fs`: the `fs` of a bot's execution group,
 * `@deepseek-ai/dsh-fs-ssh`'s file system declaring that it does not confine
 * (dsh-fs `FileSystem.sandboxMode` undefined). The bot owns its whole VM, so
 * DSH's file tools neither offer the model sandbox escalation
 * (`sandbox_permissions`, `justification`) nor resolve a policy for it.
 * Mutations still reach the helper with the group's `sandboxPolicy`
 * (`./full-access-policy`), which dsh-fs-ssh resolves itself.
 */
import type { Context } from "@deepseek-ai/cordis"
import { SshFileSystem } from "@deepseek-ai/dsh-fs-ssh"
import type { SandboxMode } from "@deepseek-ai/dsh-sandbox"

/** dsh-fs-ssh's class, seen as dsh-fs declares the capability: a mode, or none. */
const SshFileSystemBase: new (
  ctx: Context,
) => Omit<SshFileSystem, "sandboxMode"> & { get sandboxMode(): SandboxMode | undefined } =
  SshFileSystem

export default class BotVmFileSystem extends SshFileSystemBase {
  static inject = SshFileSystem.inject

  override get sandboxMode(): undefined {
    return undefined
  }
}
