import { spawn } from "node:child_process"
import type { OpEnvironment } from "./environment"
import { OpFailure, reasonOf } from "./failure"

/** One op invocation; `name` (`item get`…) is what errors say. */
export interface OpCommand {
  readonly name: string
  readonly args: readonly string[]
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

const MAX_STDERR_BYTES = 64 * 1024

const wipeAll = (chunks: readonly Uint8Array[]) => {
  for (const chunk of chunks) chunk.fill(0)
}

function joined(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * Run op (design rule 68: the only process this package starts): no shell,
 * the given environment only, stdout kept as bytes the caller owns and
 * wipes. Every chunk read is wiped once copied; on any failure stdout is
 * wiped and the error names a reason, never op's output.
 * @throws OpFailure
 */
export function runOp(
  binary: string,
  command: OpCommand,
  env: OpEnvironment,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (signal.aborted) return Promise.reject(new OpFailure("aborted", command.name))
  return new Promise((resolve, reject) => {
    const stdout: Uint8Array[] = []
    const stderr: Uint8Array[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let stopped: "aborted" | "timeout" | "too-large" | undefined
    const child = spawn(binary, [...command.args], {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stop = (why: "aborted" | "timeout" | "too-large") => {
      stopped ??= why
      child.kill("SIGKILL")
    }
    const timer = setTimeout(() => stop("timeout"), command.timeoutMs)
    const onAbort = () => stop("aborted")
    signal.addEventListener("abort", onAbort, { once: true })
    child.stdout.on("data", (chunk: Buffer) => {
      if (stopped !== undefined || stdoutBytes + chunk.length > command.maxOutputBytes) {
        chunk.fill(0)
        stop("too-large")
        return
      }
      stdout.push(chunk)
      stdoutBytes += chunk.length
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < MAX_STDERR_BYTES) {
        stderr.push(chunk)
        stderrBytes += chunk.length
      }
    })
    let settled = false
    const settle = (outcome: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      outcome()
    }
    child.on("error", () => {
      settle(() => {
        wipeAll(stdout)
        reject(new OpFailure("failed", command.name))
      })
    })
    child.on("close", (code) => {
      settle(() => {
        if (stopped !== undefined || code !== 0) {
          wipeAll(stdout)
          const reason =
            stopped ??
            reasonOf(Buffer.concat(stderr).subarray(0, MAX_STDERR_BYTES).toString("utf8"))
          reject(new OpFailure(reason, command.name, code ?? undefined))
          return
        }
        const out = joined(stdout, stdoutBytes)
        wipeAll(stdout)
        resolve(out)
      })
    })
  })
}
