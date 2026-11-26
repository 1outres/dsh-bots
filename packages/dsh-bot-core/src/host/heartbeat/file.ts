import type { EnvironmentFileSystem } from "../files"
import type { HeartbeatFile } from "./decide"

export const HEARTBEAT_FILE = "HEARTBEAT.md"

export const MAX_HEARTBEAT_BYTES = 16 * 1024

const ABSENT: HeartbeatFile = { kind: "absent" }

export async function readHeartbeatFile(
  fs: EnvironmentFileSystem,
  workspace: string,
  signal: AbortSignal,
): Promise<HeartbeatFile> {
  if ((await fs.lstat(HEARTBEAT_FILE, { cwd: workspace }, signal)) === undefined) return ABSENT
  const target = await fs.resolve(HEARTBEAT_FILE, { cwd: workspace, signal })
  const info = await fs.stat(target, signal)
  if (info?.type !== "file") return ABSENT
  if (info.size !== undefined && info.size > MAX_HEARTBEAT_BYTES) {
    return { kind: "too-large", bytes: info.size }
  }
  const bytes = await fs.readBytes(target, signal, MAX_HEARTBEAT_BYTES)
  return { kind: "text", text: new TextDecoder().decode(bytes) }
}
