import type {
  CapacityRequest,
  ImageBackend,
  InstanceBackend,
  InstanceChange,
  InstanceRecord,
  InstanceStatus,
  VmBackend,
  WorkspaceBackend,
  WorkspaceRecord,
} from "../contract"
import { CONFIG_BOT_ID, CONFIG_ORPHANED, CONFIG_OWNER } from "../tags"
import { allocationOf, capacityOf } from "./capacity"
import { backendCheckOf, checkIncus, type IncusDeclaration, type IncusOrigin } from "./check"
import type { IncusClient, IncusInstance, IncusVolume } from "./client"
import { layoutOf, WORKSPACE_BY_ID } from "./layout"
import { reconfigure } from "./reconfigure"
import { CPU_KEY, instanceSizesOf, MEMORY_KEY, MIB, SIZE_KEY, sizeBytesOf } from "./sizes"

export interface IncusBackendOptions {
  readonly incus: IncusClient
  readonly project: string
  readonly origin: IncusOrigin
  readonly uploadTimeoutMs: number
}

export const SSHD_COMMAND = ["/usr/sbin/sshd", "-i"] as const

const STATUS: Readonly<Record<string, InstanceStatus>> = {
  Running: "running",
  Stopped: "stopped",
  Frozen: "frozen",
}

const tagsOf = (config: Readonly<Record<string, string>>) => ({
  botId: config[CONFIG_BOT_ID],
  owner: config[CONFIG_OWNER],
  orphanedSince: config[CONFIG_ORPHANED] === "" ? undefined : config[CONFIG_ORPHANED],
})

function instanceRecordOf(instance: IncusInstance): InstanceRecord {
  const sizes = instanceSizesOf(instance)
  const memoryMiB = sizes.memoryBytes === undefined ? undefined : sizes.memoryBytes / MIB
  return {
    name: instance.name,
    ...tagsOf(instance.config),
    status: STATUS[instance.status] ?? "other",
    statusText: instance.status,
    cpus: sizes.cpus,
    memoryMiB: memoryMiB !== undefined && Number.isSafeInteger(memoryMiB) ? memoryMiB : undefined,
  }
}

function workspaceRecordOf(volume: IncusVolume): WorkspaceRecord {
  return {
    name: volume.name,
    ...tagsOf(volume.config),
    block: volume.contentType === "block",
    sizeBytes: sizeBytesOf(volume.config[SIZE_KEY]),
    sizeText: volume.config[SIZE_KEY] ?? "",
    attached: volume.usedBy.length > 0,
  }
}

const orphanMark = (since: string | undefined) => ({ [CONFIG_ORPHANED]: since ?? "" })

export function createIncusBackend(options: IncusBackendOptions): VmBackend {
  const { incus, project } = options
  let declared: IncusDeclaration | undefined

  async function check(signal?: AbortSignal) {
    const result = await checkIncus({ incus, project, origin: options.origin }, signal)
    declared = result.ok ? result.declaration : undefined
    return result
  }

  async function declaration(signal?: AbortSignal): Promise<IncusDeclaration> {
    if (declared !== undefined) return declared
    const result = await check(signal)
    if (result.ok) return result.declaration
    throw new Error(
      `the Incus project "${project}" cannot hold bot VMs: ${result.problems.map((problem) => problem.message).join("; ")}`,
    )
  }

  async function instanceOf(name: string, signal?: AbortSignal): Promise<IncusInstance> {
    const found = await incus.instance(name, signal)
    if (found === undefined) throw new Error(`Incus instance "${name}" disappeared`)
    return found
  }

  const instances: InstanceBackend = {
    async list(owner, signal) {
      return (await incus.instances(signal))
        .map(instanceRecordOf)
        .filter((record) => record.owner === owner)
    },
    async get(name, signal) {
      const found = await incus.instance(name, signal)
      return found === undefined ? undefined : instanceRecordOf(found)
    },
    async create(spec, signal) {
      const layout = layoutOf(spec, await declaration(signal))
      await incus.create(
        {
          name: spec.name,
          description: spec.description,
          image: spec.image,
          profiles: [],
          config: {
            ...layout.config,
            "cloud-init.user-data": spec.userData,
            [CONFIG_BOT_ID]: spec.botId,
            [CONFIG_OWNER]: spec.owner,
          },
          devices: layout.devices,
          start: false,
        },
        signal,
      )
    },
    async change(shape, signal): Promise<InstanceChange> {
      const found = await instanceOf(shape.name, signal)
      const plan = reconfigure(found, layoutOf(shape, await declaration(signal)))
      const change = plan.change
      if (change === undefined) return { kind: "none" }
      const what = [
        ...[CPU_KEY, MEMORY_KEY].flatMap((key) =>
          change.config?.[key] === undefined ? [] : [`${key} ${change.config[key]}`],
        ),
        ...Object.keys(change.devices ?? {}).map((device) => `device ${device}`),
      ]
      return { kind: plan.restarts ? "restart" : "live", what }
    },
    async conform(shape, signal) {
      const found = await instanceOf(shape.name, signal)
      const plan = reconfigure(found, layoutOf(shape, await declaration(signal)))
      if (plan.change !== undefined) await incus.update(shape.name, plan.change, signal)
    },
    async start(name, signal) {
      const found = await instanceOf(name, signal)
      if (found.status === "Running") return
      await incus.setState(name, found.status === "Frozen" ? "unfreeze" : "start", signal)
    },
    settle: async () => {},
    stop: (name, signal) => incus.setState(name, "stop", signal),
    remove: (name, signal) => incus.destroy(name, signal),
    markOrphaned: (name, since, signal) => incus.patchConfig(name, orphanMark(since), signal),
  }

  const workspaces: WorkspaceBackend = {
    async list(owner, signal) {
      const { pool } = await declaration(signal)
      return (await incus.volumes(pool, signal))
        .map(workspaceRecordOf)
        .filter((record) => record.owner === owner)
    },
    async get(name, signal) {
      const { pool } = await declaration(signal)
      const found = await incus.volume(pool, name, signal)
      return found === undefined ? undefined : workspaceRecordOf(found)
    },
    async create(spec, signal) {
      const { pool } = await declaration(signal)
      await incus.createVolume(
        {
          pool,
          name: spec.name,
          contentType: "block",
          description: spec.description,
          config: {
            [SIZE_KEY]: `${spec.sizeGiB}GiB`,
            [CONFIG_BOT_ID]: spec.botId,
            [CONFIG_OWNER]: spec.owner,
          },
        },
        signal,
      )
    },
    async grow(name, sizeGiB, signal) {
      const { pool } = await declaration(signal)
      await incus.patchVolume(pool, name, { [SIZE_KEY]: `${sizeGiB}GiB` }, signal)
    },
    async markOrphaned(name, since, signal) {
      const { pool } = await declaration(signal)
      await incus.patchVolume(pool, name, orphanMark(since), signal)
    },
    async remove(name, signal) {
      const { pool } = await declaration(signal)
      await incus.deleteVolume(pool, name, signal)
    },
  }

  async function discard(fingerprint: string, signal?: AbortSignal): Promise<void> {
    const image = await incus.image(fingerprint, signal)
    if (image !== undefined && image.aliases.length === 0)
      await incus.deleteImage(fingerprint, signal)
  }

  const images: ImageBackend = {
    target: (alias, signal) => incus.alias(alias, signal),
    has: async (fingerprint, signal) => (await incus.image(fingerprint, signal)) !== undefined,
    upload: (source, signal) =>
      incus.importImage(source.body, { timeoutMs: options.uploadTimeoutMs, signal }),
    discard,
    async point(alias, fingerprint, signal) {
      const old = await incus.alias(alias, signal)
      await incus.setAlias(alias, fingerprint, signal)
      return old
    },
  }

  async function capacity(request: CapacityRequest, signal?: AbortSignal) {
    const { pool } = await declaration(signal)
    const [host, state, poolBytes, own] = await Promise.all([
      incus.hostResources(signal),
      incus.projectState(signal),
      incus.poolSpace(pool, signal),
      incus.instance(request.instance, signal),
    ])
    return capacityOf({
      project,
      host,
      pool,
      poolBytes,
      state,
      instance: own === undefined ? undefined : allocationOf(own),
      workspaceBytes: request.workspaceBytes,
      rootDiskGiB: request.rootDiskGiB,
    })
  }

  return {
    kind: "incus",
    where: `the Incus project "${project}"`,
    workspaceDevice: WORKSPACE_BY_ID,
    check: async (signal) => backendCheckOf(await check(signal)),
    capacity,
    instances,
    workspaces,
    images,
    guest: {
      sshd: "inetd",
      async open(instance, signal) {
        const session = await incus.exec(
          instance,
          { command: SSHD_COMMAND, user: 0, group: 0, environment: {} },
          signal,
        )
        return {
          input: session.stdin,
          output: session.stdout,
          diagnostics: session.stderr,
          close: () => session.destroy(),
        }
      },
    },
  }
}
