import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import type { PinnedHostKey, SshTarget } from "@1outres/dsh-bot-core"

export function hostKeyFingerprint(hostKey: string): string {
  const body = hostKey.trim().split(/\s+/)[1]
  if (body === undefined) throw new Error(`"${hostKey}" is not "<type> <base64>"`)
  const digest = createHash("sha256").update(Buffer.from(body, "base64")).digest("base64")
  return `SHA256:${digest.replace(/=+$/, "")}`
}

export function pinnedHostKey(hostKey: string): PinnedHostKey {
  const type = hostKey.trim().split(/\s+/)[0]
  if (type === undefined || type === "") throw new Error(`"${hostKey}" is not "<type> <base64>"`)
  return { type, fingerprint: hostKeyFingerprint(hostKey) }
}

function run(file: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { signal, timeout: 60_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) return resolve(stdout)
        reject(new Error(`${file} failed: ${stderr.trim() || error.message}`))
      },
    )
  })
}

export async function generateSetupKey(path: string, comment: string): Promise<void> {
  await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", path])
}

export async function scanHostKeys(target: SshTarget, signal?: AbortSignal): Promise<string> {
  const output = await run(
    "ssh-keyscan",
    ["-T", "10", "-p", String(target.port), "-t", "ed25519,ecdsa,rsa", "--", target.host],
    signal,
  ).catch((error: unknown) => {
    throw new Error(`no SSH server answered at ${target.host}:${target.port} (${String(error)})`)
  })
  return output
}
