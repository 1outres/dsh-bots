import { posix } from "node:path"
import type { EnvironmentFileSystem } from "./files"

const quote = (value: string) => JSON.stringify(value)

/**
 * Read a regular file inside the bot's workspace through the environment's
 * own file system: relative paths start at the workspace, a final symlink is
 * never followed, and a path resolving outside the workspace is refused.
 * @throws an Error naming what is wrong with the path.
 */
export async function readWorkspaceFile(
  fs: EnvironmentFileSystem,
  workspace: string,
  path: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ readonly path: string; readonly name: string; readonly data: Uint8Array }> {
  if (path.trim().length === 0 || path.includes("\u0000"))
    throw new Error("the path is empty or invalid")
  const entry = await fs.lstat(path, { cwd: workspace }, signal)
  if (entry === undefined) throw new Error(`no file at ${quote(path)}`)
  if (entry.type !== "file")
    throw new Error(`${quote(path)} is a ${entry.type}, not a regular file`)
  const root = await fs.resolve(workspace, { signal })
  const target = await fs.resolve(path, { cwd: workspace, signal })
  if (!fs.contains(root, target))
    throw new Error(`${quote(path)} is outside the workspace (${workspace})`)
  const info = await fs.stat(target, signal)
  if (info?.type !== "file") throw new Error(`no regular file at ${quote(path)}`)
  if (info.size !== undefined && info.size > maxBytes) {
    throw new Error(
      `${quote(path)} has ${info.size} bytes, more than the ${maxBytes} that can be sent`,
    )
  }
  const data = await fs.readBytes(target, signal, maxBytes)
  const absolute = fs.processPath(target)
  return { path: absolute, name: posix.basename(absolute), data }
}
