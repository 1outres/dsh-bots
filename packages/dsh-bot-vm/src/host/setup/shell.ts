import type { HostSiteView } from "@1outres/dsh-bot-core"

export interface BundleFile {
  readonly path: string
  readonly mode: number
  readonly content: Uint8Array
  readonly sha256: string
}

export interface HostSetupBundle {
  readonly sha256: string
  readonly files: readonly BundleFile[]
}

export interface StagedBundle {
  readonly dir: string
  release(): Promise<void>
}

export type ShellPrivilege =
  | { readonly kind: "user" }
  | { readonly kind: "root"; readonly via: "already-root" }
  | { readonly kind: "root"; readonly via: "sudo"; readonly password: string | undefined }

export interface ShellRun {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly privilege: ShellPrivilege
}

export interface ShellBroken {
  readonly code: "ssh-failed" | "host-key-changed"
  readonly message: string
}

export interface ShellExit {
  readonly code: number | null
  readonly signal: string | null
  readonly broken?: ShellBroken
}

export interface ShellProcess {
  readonly stdout: AsyncIterable<string>
  readonly stderr: AsyncIterable<string>
  control(line: "cancel"): void
  readonly exit: Promise<ShellExit>
}

export interface HostShell {
  readonly site: HostSiteView
  stage(bundle: HostSetupBundle, signal?: AbortSignal): Promise<StagedBundle>
  run(request: ShellRun, signal?: AbortSignal): ShellProcess
  dispose(): Promise<void>
}

export const HOST_SETUP_ENTRY = "vm/host-setup.sh"

export class ShellError extends Error {
  constructor(
    readonly code: "ssh-failed" | "host-key-changed" | "staging-failed",
    message: string,
  ) {
    super(message)
    this.name = "ShellError"
  }
}

export interface CollectedRun {
  readonly exit: ShellExit
  readonly stdout: readonly string[]
  readonly stderr: readonly string[]
}

export async function collect(process: ShellProcess): Promise<CollectedRun> {
  const stdout: string[] = []
  const stderr: string[] = []
  const read = async (from: AsyncIterable<string>, into: string[]) => {
    for await (const line of from) into.push(line)
  }
  const [, , exit] = await Promise.all([
    read(process.stdout, stdout),
    read(process.stderr, stderr),
    process.exit,
  ])
  return { exit, stdout, stderr }
}
