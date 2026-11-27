import type {
  BotEnvironmentCapacity,
  EnvironmentHostDeclaration,
  EnvironmentHostProblem,
  VmBackendKind,
} from "@1outres/dsh-bot-core"

export type BackendCheck =
  | { readonly ok: true; readonly declaration: EnvironmentHostDeclaration }
  | { readonly ok: false; readonly problems: readonly EnvironmentHostProblem[] }

export interface CapacityRequest {
  readonly instance: string
  readonly rootDiskGiB: number
}

export interface VmBackend {
  readonly kind: VmBackendKind
  readonly where: string
  readonly workspaceDevice: string
  check(signal?: AbortSignal): Promise<BackendCheck>
  capacity(request: CapacityRequest, signal?: AbortSignal): Promise<BotEnvironmentCapacity>
  readonly instances: InstanceBackend
  readonly workspaces: WorkspaceBackend
  readonly images: ImageBackend
  readonly guest: GuestRoute
}

export type InstanceStatus = "running" | "stopped" | "frozen" | "other"

export interface Tagged {
  readonly name: string
  readonly botId: string | undefined
  readonly owner: string | undefined
  readonly orphanedSince: string | undefined
}

export interface InstanceRecord extends Tagged {
  readonly status: InstanceStatus
  readonly statusText: string
  readonly cpus: number | undefined
  readonly memoryMiB: number | undefined
}

export interface InstanceResources {
  readonly cpus: number
  readonly memoryMiB: number
  readonly rootDiskGiB: number
}

export interface InstanceShape {
  readonly name: string
  readonly resources: InstanceResources
  readonly workspace: string
}

export interface InstanceSpec extends InstanceShape {
  readonly botId: string
  readonly owner: string
  readonly description: string
  readonly image: string
  readonly userData: string
}

export type InstanceChange =
  | { readonly kind: "none" }
  | { readonly kind: "live"; readonly what: readonly string[] }
  | { readonly kind: "restart"; readonly what: readonly string[] }

export interface InstanceBackend {
  list(owner: string, signal?: AbortSignal): Promise<readonly InstanceRecord[]>
  get(name: string, signal?: AbortSignal): Promise<InstanceRecord | undefined>
  create(spec: InstanceSpec, signal?: AbortSignal): Promise<void>
  change(shape: InstanceShape, signal?: AbortSignal): Promise<InstanceChange>
  conform(shape: InstanceShape, signal?: AbortSignal): Promise<void>
  start(name: string, signal?: AbortSignal): Promise<void>
  settle(name: string, signal?: AbortSignal): Promise<void>
  stop(name: string, signal?: AbortSignal): Promise<void>
  remove(name: string, signal?: AbortSignal): Promise<void>
  markOrphaned(name: string, since: string | undefined, signal?: AbortSignal): Promise<void>
}

export interface WorkspaceRecord extends Tagged {
  readonly block: boolean
  readonly sizeBytes: number | undefined
  readonly sizeText: string
  readonly attached: boolean
}

export interface WorkspaceSpec {
  readonly name: string
  readonly botId: string
  readonly owner: string
  readonly description: string
  readonly sizeGiB: number
}

export interface WorkspaceBackend {
  list(owner: string, signal?: AbortSignal): Promise<readonly WorkspaceRecord[]>
  get(name: string, signal?: AbortSignal): Promise<WorkspaceRecord | undefined>
  create(spec: WorkspaceSpec, signal?: AbortSignal): Promise<void>
  grow(name: string, sizeGiB: number, signal?: AbortSignal): Promise<void>
  markOrphaned(name: string, since: string | undefined, signal?: AbortSignal): Promise<void>
  remove(name: string, signal?: AbortSignal): Promise<void>
}

export interface ImageSource {
  readonly fingerprint: string
  readonly bytes: number
  readonly body: AsyncIterable<Uint8Array>
}

export interface ImageBackend {
  target(alias: string, signal?: AbortSignal): Promise<string | undefined>
  has(fingerprint: string, signal?: AbortSignal): Promise<boolean>
  upload(source: ImageSource, signal?: AbortSignal): Promise<string>
  discard(fingerprint: string, signal?: AbortSignal): Promise<void>
  point(alias: string, fingerprint: string, signal?: AbortSignal): Promise<string | undefined>
}

export interface GuestInput {
  write(data: Uint8Array): Promise<void>
  end(): Promise<void>
}

export interface GuestChannel {
  readonly input: GuestInput
  readonly output: AsyncIterable<Uint8Array>
  readonly diagnostics: AsyncIterable<Uint8Array>
  close(): void
}

export type GuestSshd = "inetd" | "listening"

export interface GuestRoute {
  readonly sshd: GuestSshd
  open(instance: string, signal?: AbortSignal): Promise<GuestChannel>
}
