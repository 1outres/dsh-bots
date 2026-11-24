/**
 * ssh ProxyCommand of a bot VM (see src/host/vsock.ts): looks the VM's vsock
 * id up in Incus, then runs socat with this process's stdin/stdout.
 */
import { spawn } from "node:child_process"
import { createIncusClient } from "../host/incus"
import { parseProxyArgs, socatArgs, vsockCidOf } from "../host/vsock"
import { unixSocketTransport } from "../node/unix-socket"

const REQUEST_TIMEOUT_MS = 15_000

async function main(): Promise<number> {
  const args = parseProxyArgs(process.argv.slice(2))
  const incus = createIncusClient({
    transport: unixSocketTransport(args.socket),
    project: args.project,
    operationTimeoutMs: REQUEST_TIMEOUT_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  })
  const instance = await incus.instance(args.instance)
  if (instance === undefined) throw new Error(`Incus instance "${args.instance}" does not exist`)
  const child = spawn(args.socat, socatArgs(vsockCidOf(instance), args.port), {
    stdio: "inherit",
  })
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => child.kill(signal))
  }
  return new Promise((resolve, reject) => {
    child.on("error", (error) => reject(new Error(`${args.socat}: ${error.message}`)))
    child.on("exit", (code, signal) => resolve(code ?? (signal === null ? 1 : 128)))
  })
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(
      `dsh-bot-vm vsock-proxy: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(255)
  },
)
