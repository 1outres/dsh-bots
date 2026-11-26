import type { Context } from "@deepseek-ai/cordis"
import { SshFileSystem } from "@deepseek-ai/dsh-fs-ssh"
import type { SandboxMode } from "@deepseek-ai/dsh-sandbox"

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
