import type { InboxWriter } from "./inbox"

/**
 * dsh-subprocess `SubprocessRuntime` with stdin piped and output collected,
 * structurally: DSH's `FileSystem` writes only UTF-8 text, so binary files go
 * through a process of the bot's own environment (the same VM and user its
 * tools run as), never the Host's file system.
 */
export interface EnvironmentWriteProcess {
  readonly stdin:
    | {
        end(data?: Uint8Array): unknown
        on(event: "error", listener: (error: Error) => void): unknown
      }
    | undefined
  readonly collected: {
    readonly stdout?: {
      readFrom(offset: number): { readonly text: string; readonly lossy?: boolean }
    }
    readonly stderr?: {
      readFrom(offset: number): { readonly text: string; readonly lossy?: boolean }
    }
  }
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>
}

export interface EnvironmentWriteSubprocess {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: {
      stdin: "pipe" | "ignore"
      stdout: { maxBytes: number }
      stderr: { maxBytes: number }
    }
    graceMs: number
    signal: AbortSignal
  }): EnvironmentWriteProcess
}

const OUTPUT_BYTES = 16 * 1024
const GRACE_MS = 2000
/** Most folders tried for one message (`base`, `base-2` … `base-99`). */
export const MAX_FOLDER_ATTEMPTS = 99

const CREATE_FOLDER = [
  "set -eu",
  "root=$1 base=$2 name=$2 n=1",
  'mkdir -p -- "$root"',
  "while :; do",
  '  if mkdir -- "$root/$name" 2>/dev/null; then printf %s "$root/$name"; exit 0; fi',
  '  [ -e "$root/$name" ] || mkdir -- "$root/$name"',
  "  n=$((n + 1))",
  `  if [ "$n" -gt ${MAX_FOLDER_ATTEMPTS} ]; then echo "no free folder name for $base" >&2; exit 1; fi`,
  '  name="$base-$n"',
  "done",
].join("\n")

const WRITE_FILE = [
  "set -eu",
  "dir=$1 name=$2",
  'tmp=$(mktemp -- "$dir/.partial.XXXXXX")',
  "trap 'rm -f -- \"$tmp\"' EXIT",
  'cat > "$tmp"',
  'if [ -e "$dir/$name" ] || [ -L "$dir/$name" ]; then echo "$dir/$name already exists" >&2; exit 1; fi',
  'mv -- "$tmp" "$dir/$name"',
  "trap - EXIT",
  'printf %s "$dir/$name"',
].join("\n")

/** Write the inbox with `sh` in the bot's environment. */
export function createShellInboxWriter(
  subprocess: EnvironmentWriteSubprocess,
  cwd: string,
): InboxWriter {
  const run = async (
    script: string,
    args: readonly string[],
    data: Uint8Array | undefined,
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted()
    const handle = subprocess.spawn({
      argv: ["sh", "-c", script, "sh", ...args],
      cwd,
      stdio: {
        stdin: data === undefined ? "ignore" : "pipe",
        stdout: { maxBytes: OUTPUT_BYTES },
        stderr: { maxBytes: OUTPUT_BYTES },
      },
      graceMs: GRACE_MS,
      signal,
    })
    if (data !== undefined) {
      const stdin = handle.stdin
      if (stdin === undefined) throw new Error("the environment gave the writer no stdin")
      stdin.on("error", () => {})
      stdin.end(data)
    }
    const exit = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ""
    if (exit.exitCode !== 0) {
      const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ""
      const status = exit.signal === null ? `exit ${exit.exitCode}` : exit.signal
      throw new Error(stderr.length > 0 ? `${stderr} (${status})` : `the writer failed (${status})`)
    }
    if (stdout.length === 0) throw new Error("the writer named no path")
    return stdout
  }
  return {
    createFolder: (root, base, signal) => run(CREATE_FOLDER, [root, base], undefined, signal),
    writeFile: (folder, name, data, signal) => run(WRITE_FILE, [folder, name], data, signal),
  }
}
