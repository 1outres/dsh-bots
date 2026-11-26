import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { HostSiteView } from "@1outres/dsh-bot-core"
import {
  collect,
  type HostSetupBundle,
  type HostShell,
  type ShellBroken,
  ShellError,
  type ShellExit,
  type ShellProcess,
  type ShellRun,
  type StagedBundle,
} from "../host/setup/shell"
import { VM_HOST_ALIAS } from "../host/setup/ssh-files"
import { shellQuote } from "../host/ssh-config"
import { tarOf } from "./tar"

interface Spawned {
  readonly file: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly stdin?: Uint8Array
  readonly prelude?: string
  readonly classify?: (exit: ShellExit, stderr: readonly string[]) => ShellBroken | undefined
}

const STDERR_KEPT = 40

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = { LC_ALL: "C.UTF-8" }
  for (const key of ["PATH", "HOME", "USER", "LOGNAME"]) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function start(spawned: Spawned, signal?: AbortSignal): ShellProcess {
  signal?.throwIfAborted()
  const child = spawn(spawned.file, [...spawned.args], {
    env: { ...baseEnv(), ...spawned.env },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const stdin = child.stdin
  stdin.on("error", () => {})
  if (spawned.stdin !== undefined) stdin.end(spawned.stdin)
  else if (spawned.prelude !== undefined) stdin.write(spawned.prelude)
  const stderrSeen: string[] = []
  const stdout = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
  const stderrLines = createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY })
  const stderr: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      for await (const line of stderrLines) {
        stderrSeen.push(line)
        if (stderrSeen.length > STDERR_KEPT) stderrSeen.shift()
        yield line
      }
    },
  }
  const stop = () => {
    stdin.end()
    child.kill("SIGTERM")
  }
  signal?.addEventListener("abort", stop, { once: true })
  const exit = new Promise<ShellExit>((resolve) => {
    child.on("error", (error) => {
      stderrSeen.push(`${spawned.file}: ${error.message}`)
      resolve({ code: 127, signal: null })
    })
    child.on("close", (code, killed) => {
      signal?.removeEventListener("abort", stop)
      stdin.end()
      const result: ShellExit = { code, signal: killed }
      const broken = spawned.classify?.(result, stderrSeen)
      resolve(broken === undefined ? result : { ...result, broken })
    })
  })
  return {
    stdout,
    stderr,
    control(line) {
      if (!stdin.writableEnded) stdin.write(`${line}\n`)
    },
    exit,
  }
}

const assignments = (env: Readonly<Record<string, string>>) =>
  Object.entries(env).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key))
      throw new Error(`"${key}" is not an environment variable name`)
    return `${key}=${value}`
  })

export function privilegedArgv(request: ShellRun): readonly string[] {
  const command = ["env", ...assignments(request.env), ...request.argv]
  const { privilege } = request
  if (privilege.kind === "user" || privilege.via === "already-root") return command
  return privilege.password === undefined
    ? ["sudo", "-n", "--", ...command]
    : ["sudo", "-S", "-p", "", "--", ...command]
}

const preludeOf = (request: ShellRun) =>
  request.privilege.kind === "root" &&
  request.privilege.via === "sudo" &&
  request.privilege.password !== undefined
    ? `${request.privilege.password}\n`
    : undefined

export function localShell(bundleDir: string): HostShell {
  return {
    site: { kind: "this-machine" },
    async stage(): Promise<StagedBundle> {
      return { dir: bundleDir, release: async () => {} }
    },
    run(request, signal) {
      const [file, ...args] = privilegedArgv(request)
      const prelude = preludeOf(request)
      return start(
        { file: file as string, args, env: {}, ...(prelude === undefined ? {} : { prelude }) },
        signal,
      )
    },
    async dispose() {},
  }
}

export const STAGE_PREFIX = "dsh-bots-host-setup."
export const STAGE_LOCK = ".in-use"
export const STALE_STAGE_MINUTES = 10

export function stageScript(paths: readonly string[]): string {
  return [
    "set -eu",
    "umask 077",
    `for old in "\${TMPDIR:-/tmp}"/${STAGE_PREFIX}*; do`,
    '  [ -d "$old" ] && [ ! -L "$old" ] && [ -O "$old" ] || continue',
    `  [ -n "$(find "$old" -maxdepth 0 -mmin +${STALE_STAGE_MINUTES})" ] || continue`,
    `  flock -n -x "$old/${STAGE_LOCK}" rm -rf -- "$old" || true`,
    "done",
    `d=$(mktemp -d -t ${STAGE_PREFIX}XXXXXXXX)`,
    'tar -xf - -C "$d"',
    `: > "$d/${STAGE_LOCK}"`,
    'printf "dir %s\\n" "$d"',
    `cd "$d" && sha256sum -- ${paths.map(shellQuote).join(" ")}`,
  ].join("\n")
}

const HELD = "held"

async function firstLine(process: ShellProcess): Promise<string | undefined> {
  for await (const line of process.stdout) return line
  return undefined
}

const HOST_KEY_CHANGED =
  /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key for .* has changed/i

export function sshBroken(exit: ShellExit, stderr: readonly string[]): ShellBroken | undefined {
  if (exit.code !== 255) return undefined
  const said = stderr
    .filter((line) => line.trim() !== "")
    .slice(-3)
    .join(" ")
  if (HOST_KEY_CHANGED.test(stderr.join("\n"))) {
    return {
      code: "host-key-changed",
      message: `the VM host's SSH host key is not the pinned one: ${said}`,
    }
  }
  return { code: "ssh-failed", message: `ssh to the VM host failed: ${said || "exit code 255"}` }
}

export function sshShell(config: string, site: HostSiteView): HostShell {
  const over = (
    command: readonly string[],
    extra: Omit<Spawned, "file" | "args" | "env"> = {},
  ) => ({
    file: "ssh",
    args: ["-F", config, "-T", VM_HOST_ALIAS, "--", command.map(shellQuote).join(" ")],
    env: {},
    classify: sshBroken,
    ...extra,
  })
  const failedStage = (message: string) => new ShellError("staging-failed", message)
  return {
    site,
    async stage(bundle: HostSetupBundle, signal?: AbortSignal): Promise<StagedBundle> {
      const script = stageScript(bundle.files.map((file) => file.path))
      const run = await collect(
        start(over(["sh", "-c", script], { stdin: tarOf(bundle.files) }), signal),
      )
      if (run.exit.broken !== undefined)
        throw new ShellError(run.exit.broken.code, run.exit.broken.message)
      const dir = /^dir (\/\S+)$/.exec(run.stdout[0] ?? "")?.[1]
      if (run.exit.code !== 0 || dir === undefined) {
        throw failedStage(
          `sending the host setup to the VM host failed: ${run.stderr.slice(-3).join(" ") || `exit code ${run.exit.code}`}`,
        )
      }
      const remove = async () => {
        await collect(start(over(["rm", "-rf", "--", dir])))
      }
      const sums = new Map(
        run.stdout.slice(1).map((line) => {
          const [sum, path] = line.split(/\s+\*?/, 2)
          return [path ?? "", sum ?? ""] as const
        }),
      )
      const changed = bundle.files.filter((file) => sums.get(file.path) !== file.sha256)
      if (changed.length > 0) {
        await remove()
        throw failedStage(
          `the host setup arrived changed on the VM host: ${changed.map((file) => file.path).join(", ")}`,
        )
      }
      const holding = new AbortController()
      const holder = start(
        over([
          "flock",
          "-s",
          `${dir}/${STAGE_LOCK}`,
          "sh",
          "-c",
          `echo ${HELD}; exec cat >/dev/null`,
        ]),
        holding.signal,
      )
      const held = await firstLine(holder)
      if (held !== HELD) {
        const exit = await holder.exit
        await remove()
        throw failedStage(
          `locking the host setup on the VM host failed: ${exit.broken?.message ?? `exit code ${exit.code}`}`,
        )
      }
      const release = async () => {
        holding.abort()
        await holder.exit
        await remove()
      }
      return { dir, release }
    },
    run(request, signal) {
      const prelude = preludeOf(request)
      return start(over(privilegedArgv(request), prelude === undefined ? {} : { prelude }), signal)
    },
    async dispose() {},
  }
}
