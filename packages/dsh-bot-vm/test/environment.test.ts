import { describe, expect, it } from "vitest"
import type { WorkspaceRecord } from "../src/host/backend/contract"
import { createIncusBackend } from "../src/host/backend/incus/backend"
import type {
  IncusClient,
  IncusInstance,
  IncusVolume,
  InstanceSpec,
  StateAction,
} from "../src/host/backend/incus/client"
import { layoutOf } from "../src/host/backend/incus/layout"
import { reconfigure } from "../src/host/backend/incus/reconfigure"
import { sizeBytesOf } from "../src/host/backend/incus/sizes"
import { type EgressReport, egressProbeScript } from "../src/host/egress-probe"
import {
  type CommandResult,
  createVmEnvironment,
  type EnvironmentDeps,
  type EnvironmentFiles,
  type EnvironmentSettings,
} from "../src/host/environment"
import { volumePlan } from "../src/host/workspace-volume"
import { incusWith } from "./support/incus"

const DAY = 24 * 3_600_000

const settings: EnvironmentSettings = {
  stateDir: "/state",
  owner: "owner-a",
  orphanGraceMs: 7 * DAY,
  instancePrefix: "dsh-bot-",
  hostAliasPrefix: "dsh-bot-",
  image: "dsh-bot-base",
  rootDiskGiB: 16,
  guestUser: "bot",
  workspace: "/home/bot/workspace",
  guestProxy: { node: "/node", script: "/lib/guest-proxy.js", socket: "/state/run/guest.sock" },
  guestRipgrep: "/usr/bin/rg",
  guestNode: "/usr/bin/node",
  helper: "/opt/helper.js",
  helperHash: "a".repeat(64),
  requestTimeoutMs: 30_000,
  readyTimeoutMs: 10_000,
  probeIntervalMs: 1_000,
  maxConcurrentProvisions: 2,
}

const HOST_RG = "/opt/dsh/node_modules/@vscode/ripgrep/bin/rg"
const proxyOf = (name: string) => `/node /lib/guest-proxy.js /state/run/guest.sock ${name}`

const SPEC = { cpus: 4, memoryMiB: 6144, diskGiB: 20 }
const target = { id: "1a2b3c4d", name: "Ada", spec: SPEC }
const alias = "dsh-bot-1a2b3c4d"
const volumeName = "dsh-bot-1a2b3c4d-workspace"
const dir = "/state/bots/1a2b3c4d"
const OWNED = { "user.dsh-bot.id": target.id, "user.dsh-bot.owner": "owner-a" }

const LAYOUT = layoutOf(
  {
    name: alias,
    resources: { cpus: SPEC.cpus, memoryMiB: SPEC.memoryMiB, rootDiskGiB: 16 },
    workspace: volumeName,
  },
  { pool: "dsh", network: "dshbr0" },
)

type FakeInstance = IncusInstance & { config: Record<string, string> }
type FakeVolume = IncusVolume & { config: Record<string, string> }

const PROJECT = {
  restricted: "true",
  "limits.memory": "56GiB",
  "user.dsh-bots.pool": "dsh",
  "user.dsh-bots.network": "dshbr0",
}

function fakeIncus() {
  const instances = new Map<string, FakeInstance>()
  const volumes = new Map<string, FakeVolume>()
  const log: string[] = []
  const created: InstanceSpec[] = []
  const host = {
    resources: { cpus: 8, memoryBytes: 64 * 1024 ** 3 },
    project: { ...PROJECT } as Record<string, string>,
    poolBytes: 80 * 1024 ** 3,
  }
  const usedBy = (name: string) =>
    [...instances.values()]
      .filter((instance) =>
        Object.values(instance.devices).some((device) => device.source === name),
      )
      .map((instance) => `/1.0/instances/${instance.name}`)
  const client: IncusClient = incusWith({
    server: async () => ({
      auth: "trusted",
      apiExtensions: [],
      serverVersion: "6.0.4",
      drivers: ["qemu"],
    }),
    projectConfig: async () => host.project,
    poolSpace: async () => host.poolBytes,
    hasNetwork: async (name) => name === "dshbr0",
    profiles: async () => [{ name: "default", devices: {} }],
    hostResources: async () => host.resources,
    async instance(name) {
      const found = instances.get(name)
      return found === undefined ? undefined : structuredClone(found)
    },
    async instances() {
      return [...instances.values()].map((instance) => structuredClone(instance))
    },
    async create(spec) {
      log.push(`create ${spec.name}`)
      created.push(spec)
      instances.set(spec.name, {
        name: spec.name,
        status: spec.start ? "Running" : "Stopped",
        config: { ...spec.config },
        devices: structuredClone(spec.devices) as FakeInstance["devices"],
      })
    },
    async update(name, change) {
      log.push(`update ${name} ${JSON.stringify(change)}`)
      const found = instances.get(name)
      if (found === undefined) throw new Error("missing")
      instances.set(name, {
        ...found,
        config: { ...found.config, ...change.config },
        devices: { ...found.devices, ...change.devices },
      })
    },
    async patchConfig(name, config) {
      log.push(`patch ${name} ${JSON.stringify(config)}`)
      const found = instances.get(name)
      if (found === undefined) throw new Error("missing")
      found.config = { ...found.config, ...config }
    },
    async setState(name, action: StateAction) {
      log.push(`${action} ${name}`)
      const found = instances.get(name)
      if (found === undefined) throw new Error("missing")
      instances.set(name, { ...found, status: action === "stop" ? "Stopped" : "Running" })
    },
    async destroy(name) {
      log.push(`destroy ${name}`)
      instances.delete(name)
    },
    async volume(pool, name) {
      const found = volumes.get(`${pool}/${name}`)
      return found === undefined ? undefined : { ...structuredClone(found), usedBy: usedBy(name) }
    },
    async volumes(pool) {
      return [...volumes.entries()]
        .filter(([key]) => key.startsWith(`${pool}/`))
        .map(([, volume]) => ({ ...structuredClone(volume), usedBy: usedBy(volume.name) }))
    },
    async createVolume(spec) {
      log.push(`volume create ${spec.name} ${spec.config.size}`)
      volumes.set(`${spec.pool}/${spec.name}`, {
        name: spec.name,
        contentType: spec.contentType,
        config: { ...spec.config },
        usedBy: [],
      })
    },
    async patchVolume(pool, name, config) {
      log.push(`volume patch ${name} ${JSON.stringify(config)}`)
      const found = volumes.get(`${pool}/${name}`)
      if (found === undefined) throw new Error("missing volume")
      if (
        config.size !== undefined &&
        instances.get(name.replace(/-workspace$/, ""))?.status === "Running"
      ) {
        throw new Error("In use")
      }
      found.config = { ...found.config, ...config }
    },
    async deleteVolume(pool, name) {
      log.push(`volume delete ${name}`)
      volumes.delete(`${pool}/${name}`)
    },
  })
  const foreign = (name: string, config: Record<string, string> = {}) =>
    instances.set(name, { name, status: "Running", config, devices: {} })
  const foreignVolume = (name: string, config: Record<string, string>) =>
    volumes.set(`dsh/${name}`, { name, contentType: "block", config, usedBy: [] })
  return { client, instances, volumes, log, created, foreign, foreignVolume, host }
}

function fakeFiles() {
  const files = new Map<string, { content: string; mode: number }>()
  const dirs = new Map<string, number>()
  const api: EnvironmentFiles = {
    async read(path) {
      return files.get(path)?.content
    },
    async write(path, content, mode) {
      files.set(path, { content, mode })
    },
    async mkdir(path, mode) {
      dirs.set(path, mode)
    },
    async remove(path) {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key)
      }
      dirs.delete(path)
    },
  }
  return { api, files, dirs }
}

interface Harness {
  incus: ReturnType<typeof fakeIncus>
  files: ReturnType<typeof fakeFiles>
  commands: string[][]
  clock: { now: number }
  probe: number[]
  egress: { botId: string; report: EgressReport }[]
}

function setup(
  overrides: Partial<Harness> = {},
  patch: Partial<EnvironmentDeps> = {},
  change: Partial<EnvironmentSettings> = {},
) {
  const h: Harness = {
    incus: fakeIncus(),
    files: fakeFiles(),
    commands: [],
    clock: { now: 0 },
    probe: [],
    egress: [],
    ...overrides,
  }
  const environment = createVmEnvironment(
    { ...settings, ...change },
    {
      backend: async () => incusBackend(h.incus.client, "dsh-bots"),
      image: { ready: async () => {} },
      egress: (botId, report) => h.egress.push({ botId, report }),
      files: h.files.api,
      hostRipgrep: async () => HOST_RG,
      async run(file, args): Promise<CommandResult> {
        h.commands.push([file, ...args])
        if (file === "ssh-keygen" && args[0] === "-y") {
          const path = args[2] as string
          return { code: 0, stdout: `ssh-ed25519 PUB${path.length}\n`, stderr: "" }
        }
        if (file === "ssh-keygen") {
          const path = args[args.indexOf("-f") + 1] as string
          await h.files.api.write(path, `PRIVATE ${path}`, 0o600)
          await h.files.api.write(
            `${path}.pub`,
            `ssh-ed25519 PUB${path.length} ${args[6]}\n`,
            0o644,
          )
          return { code: 0, stdout: "", stderr: "" }
        }
        const code = h.probe.shift() ?? 0
        return { code, stdout: "", stderr: code === 255 ? "Connection refused" : "" }
      },
      async sleep(ms) {
        h.clock.now += ms
      },
      now: () => h.clock.now,
      log: () => {},
      ...patch,
    },
  )
  return { h, environment }
}

const incusBackend = (incus: IncusClient, project: string) =>
  createIncusBackend({ incus, project, origin: "custom", uploadTimeoutMs: 60_000 })

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing in the fake")
  return value
}

const sshCommands = (h: Harness) => h.commands.filter((command) => command[0] === "ssh")

describe("incus-vm environment", () => {
  it("declares its id, workspace and the services bot-core must isolate", () => {
    const { environment } = setup()
    expect(environment.id).toBe("incus-vm")
    expect(environment.workspace).toBe("/home/bot/workspace")
    expect(environment.isolate).toEqual(["ssh", "fs", "subprocess", "shell", "sandboxPolicy"])
  })

  it("refuses prefixes that cannot name an instance or an ssh host, and a root disk that is no size", () => {
    expect(() => setup({}, {}, { instancePrefix: "1bot-" })).toThrow("instancePrefix")
    expect(() => setup({}, {}, { hostAliasPrefix: "-x" })).toThrow("hostAliasPrefix")
    expect(() => setup({}, {}, { owner: "" })).toThrow("owner")
    expect(() => setup({}, {}, { rootDiskGiB: 0 })).toThrow("rootDiskGiB")
    for (const workspace of ["relative", "/", "/a/../b", "/a/", "/a//b"]) {
      expect(() => setup({}, {}, { workspace })).toThrow("canonical")
    }
  })

  it("returns the execution rows for a bot, all in the VM workspace", () => {
    const { environment } = setup()
    expect(environment.rows(target)).toEqual([
      {
        id: "env-ssh",
        name: "@1outres/dsh-bot-vm/ssh",
        config: {
          host: alias,
          configFile: "/state/ssh/1a2b3c4d.conf",
          launch: { kind: "node-script", node: "/usr/bin/node" },
          helper: "/opt/helper.js",
          helperHash: "a".repeat(64),
          workspace: "/home/bot/workspace",
          requestTimeoutMs: 30_000,
        },
      },
      {
        id: "env-sandbox-policy",
        name: "@1outres/dsh-bot-vm/full-access-policy",
        config: { workspaceRoot: "/home/bot/workspace" },
      },
      { id: "env-fs", name: "@1outres/dsh-bot-vm/fs" },
      { id: "env-subprocess", name: "@deepseek-ai/dsh-subprocess-ssh" },
      {
        id: "env-shell",
        name: "@deepseek-ai/dsh-bash-local",
        config: { cwd: "/home/bot/workspace" },
      },
    ])
  })

  it("creates the workspace volume, then the VM written whole into its own config, then waits for SSH", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)

    expect(h.incus.log).toEqual([
      `volume create ${volumeName} 20GiB`,
      `create ${alias}`,
      `start ${alias}`,
    ])
    expect(h.incus.volumes.get(`dsh/${volumeName}`)).toMatchObject({
      contentType: "block",
      config: { size: "20GiB", ...OWNED },
    })
    const spec = h.incus.created[0] as InstanceSpec
    expect(spec.image).toBe("dsh-bot-base")
    expect(spec.profiles).toEqual([])
    expect(spec.start).toBe(false)
    expect(spec.config).toMatchObject({
      "limits.cpu": "4",
      "limits.memory": "6144MiB",
      "boot.autostart": "true",
      "security.guestapi": "false",
      "security.secureboot": "false",
      ...OWNED,
    })
    expect(spec.config).not.toHaveProperty("raw.idmap")
    expect(spec.devices).toEqual({
      root: { type: "disk", path: "/", pool: "dsh", size: "16GiB" },
      eth0: {
        type: "nic",
        name: "eth0",
        network: "dshbr0",
        "security.port_isolation": "true",
        "security.mac_filtering": "true",
        "security.ipv4_filtering": "true",
      },
      workspace: { type: "disk", pool: "dsh", source: volumeName },
    })

    const userData = spec.config["cloud-init.user-data"] as string
    const document = JSON.parse(userData.slice("#cloud-config\n".length))
    expect(document.users[0].ssh_authorized_keys).toEqual([
      `ssh-ed25519 PUB${`${dir}/id_ed25519`.length} ${alias}`,
    ])
    expect(document.ssh_keys.ed25519_private).toBe(`PRIVATE ${dir}/ssh_host_ed25519_key`)
    expect(document.mounts[0].slice(0, 3)).toEqual([
      "/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_workspace",
      "/home/bot/workspace",
      "ext4",
    ])
    expect(document.fs_setup).toBeUndefined()

    const conf = h.files.files.get("/state/ssh/1a2b3c4d.conf")
    expect(conf?.mode).toBe(0o600)
    for (const line of [
      `Host ${alias}`,
      `ProxyCommand ${proxyOf(alias)}`,
      "ProxyUseFdpass no",
      `IdentityFile ${dir}/id_ed25519`,
      `UserKnownHostsFile ${dir}/known_hosts`,
      `HostKeyAlias ${alias}`,
      "User bot",
    ]) {
      expect(conf?.content).toContain(`${line}\n`)
    }
    expect(sshCommands(h)[0]).toEqual([
      "ssh",
      "-F",
      "/state/ssh/1a2b3c4d.conf",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=10",
      alias,
      "test -e /var/lib/cloud/instance/boot-finished && mountpoint -q '/home/bot/workspace' && test -w '/home/bot/workspace'",
    ])
    expect(sshCommands(h)).toHaveLength(4)
    expect(sshCommands(h)[3]?.at(-1)).toBe(egressProbeScript())
    expect(sshCommands(h)[1]?.slice(-2)).toEqual([
      alias,
      "cd '/home/bot/workspace' && '/usr/bin/node' --disable-sigusr1 '/opt/helper.js' </dev/null >/dev/null 2>&1; exit 0",
    ])
  })

  it("stops before anything when the project cannot hold bot VMs, saying what to fix", async () => {
    const { h, environment } = setup()
    h.incus.host.project = { restricted: "true" }
    await expect(environment.ensure(target)).rejects.toThrow(
      'the Incus project "dsh-bots" cannot hold bot VMs: the project "dsh-bots" names no storage pool (user.dsh-bots.pool) (incus project set dsh-bots user.dsh-bots.pool=<pool>); ',
    )
    const local = setup({}, { backend: async () => incusBackend(fakeIncus().client, "default") })
    await expect(local.environment.ensure(target)).rejects.toThrow(
      'never use the Incus project "default"',
    )
    expect([...h.incus.log, ...local.h.incus.log]).toEqual([])
    expect(h.files.files.size).toBe(0)
  })

  it("measures from inside the VM what it reaches that it must not, and only reports it", async () => {
    const outputs: Record<string, CommandResult> = {
      open: {
        code: 0,
        stdout: "gateway 10.20.0.1\nopen 10.20.0.1:22\nopen 10.0.0.1:22\n",
        stderr: "",
      },
      failed: { code: 255, stdout: "", stderr: "Connection closed" },
    }
    for (const [name, output] of Object.entries(outputs)) {
      const { h, environment } = setup(
        {},
        {
          async run(file, args) {
            if (file === "ssh-keygen") {
              const path = args[args.indexOf("-f") + 1] as string
              await h.files.api.write(path, "PRIVATE", 0o600)
              await h.files.api.write(`${path}.pub`, "ssh-ed25519 K", 0o600)
              return { code: 0, stdout: "", stderr: "" }
            }
            return args.at(-1) === egressProbeScript()
              ? output
              : { code: 0, stdout: "", stderr: "" }
          },
        },
      )
      await environment.ensure(target)
      expect(h.egress.map((entry) => [entry.botId, entry.report.state])).toEqual([
        [target.id, name === "open" ? "open" : "unmeasured"],
      ])
      if (name === "open") {
        expect(h.egress[0]?.report).toMatchObject({
          gateway: "10.20.0.1",
          reached: ["10.0.0.1:22", "10.20.0.1:22"],
        })
      }
    }
  })

  it("warms the helper up with a generous deadline and never fails ensure on it", async () => {
    const timeouts: (number | undefined)[] = []
    const logs: string[] = []
    let calls = 0
    const files = fakeFiles()
    for (const key of ["id_ed25519", "ssh_host_ed25519_key"]) {
      await files.api.write(`${dir}/${key}`, "PRIVATE", 0o600)
    }
    const prepared = setup(
      { files },
      {
        async run(file, _args, options) {
          if (file === "ssh-keygen") return { code: 0, stdout: "ssh-ed25519 K", stderr: "" }
          calls++
          timeouts.push(options?.timeoutMs)
          return calls === 2
            ? { code: 255, stdout: "", stderr: "timed out" }
            : { code: 0, stdout: "", stderr: "" }
        },
        log: (message) => logs.push(message),
      },
    )
    await prepared.environment.ensure(target)
    expect(timeouts).toEqual([30_000, 120_000, 30_000, 30_000])
    expect(
      logs.some((line) => line.includes("warming up the SSH helper") && line.includes("timed out")),
    ).toBe(true)
  })

  it("reports its steps: queued for a slot, creating, booting, then connecting", async () => {
    const { environment } = setup()
    const steps: string[] = []
    await environment.ensure(target, { progress: (phase) => steps.push(phase) })
    expect(steps).toEqual(["queued", "creating", "booting", "connecting"])
  })

  it("waits for the base image before creating a VM, reporting it while an import runs, and only then", async () => {
    const gate: string[] = []
    const { h, environment } = setup(
      {},
      {
        image: {
          async ready(_signal, importing) {
            gate.push("ready")
            importing()
          },
        },
      },
    )
    const steps: string[] = []
    await environment.ensure(target, { progress: (phase) => steps.push(phase) })
    expect(steps).toEqual(["image", "creating", "booting", "connecting"])
    await h.incus.client.setState(alias, "stop")
    await environment.ensure(target)
    expect(gate).toEqual(["ready"])
  })

  it("does not create a VM when the base image cannot be made ready", async () => {
    const { h, environment } = setup(
      {},
      { image: { ready: () => Promise.reject(new Error("the base image is not ready")) } },
    )
    await expect(environment.ensure(target)).rejects.toThrow("the base image is not ready")
    expect(await h.incus.client.instance(alias)).toBeUndefined()
  })

  it("skips creating and booting for a VM that runs, and boots a stopped one", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const steps: string[] = []
    await environment.ensure(target, { progress: (phase) => steps.push(phase) })
    expect(steps).toEqual(["connecting"])
    await h.incus.client.setState(alias, "stop")
    steps.length = 0
    await environment.ensure(target, { progress: (phase) => steps.push(phase) })
    expect(steps).toEqual(["queued", "booting", "connecting"])
  })

  it("keeps the files of a re-created VM: the volume stays and is attached again", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    await h.incus.client.destroy(alias)
    await environment.ensure(target)
    expect(h.incus.log.filter((line) => line.startsWith("volume create"))).toHaveLength(1)
    expect(h.incus.log.filter((line) => line.startsWith("create"))).toHaveLength(2)
    expect(h.incus.instances.get(alias)?.devices.workspace).toEqual({
      type: "disk",
      pool: "dsh",
      source: volumeName,
    })
  })

  it("derives a lost public key again and never replaces a private key the VM holds", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    await h.files.api.remove(`${dir}/id_ed25519.pub`)
    await environment.ensure(target)
    expect(h.files.files.get(`${dir}/id_ed25519.pub`)?.content).toContain("ssh-ed25519")
    await h.files.api.remove(`${dir}/id_ed25519`)
    await h.files.api.remove(`${dir}/id_ed25519.pub`)
    await expect(environment.ensure(target)).rejects.toThrow("is missing while its VM exists")
  })

  it("creates at most maxConcurrentProvisions VMs at once", async () => {
    let running = 0
    let most = 0
    const { h, environment: limited } = setup()
    const create = h.incus.client.create
    h.incus.client.create = async (spec, signal) => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return create(spec, signal)
    }
    await Promise.all(
      ["b0000001", "b0000002", "b0000003", "b0000004"].map((id) =>
        limited.ensure({ id, name: id, spec: SPEC }),
      ),
    )
    expect(most).toBe(2)
  })

  it("serializes concurrent ensures of one bot", async () => {
    const { h, environment } = setup()
    await Promise.all([environment.ensure(target), environment.ensure(target)])
    expect(h.incus.log.filter((line) => line.startsWith("create"))).toHaveLength(1)
  })

  it("waits until SSH answers and the workspace is the mounted, writable volume, then gives up", async () => {
    const { h, environment } = setup({ probe: [255, 32, 255] })
    await environment.ensure(target)
    expect(h.clock.now).toBe(3_000)
    const slow = setup({ probe: Array(50).fill(255) })
    await expect(slow.environment.ensure(target)).rejects.toThrow(
      `the bot VM (${alias}) is not ready within 10000 ms: it did not answer over SSH: Connection refused`,
    )
    const unmounted = setup({ probe: Array(50).fill(1) })
    await expect(unmounted.environment.ensure(target)).rejects.toThrow(
      "cloud-init has not finished, or /home/bot/workspace is not the mounted workspace volume bot can write (exit 1)",
    )
  })

  it("does not adopt an instance or a volume it did not create, or an instance missing its state", async () => {
    const foreign = setup()
    foreign.h.incus.foreign(alias)
    await expect(foreign.environment.ensure(target)).rejects.toThrow(
      "was not created by this installation",
    )
    const otherOwner = setup()
    otherOwner.h.incus.foreign(alias, { "user.dsh-bot.id": target.id, "user.dsh-bot.owner": "b" })
    await expect(otherOwner.environment.ensure(target)).rejects.toThrow("owner differs")
    expect(otherOwner.h.incus.log).toEqual([])

    const volume = setup()
    volume.h.incus.foreignVolume(volumeName, {
      size: "20GiB",
      "user.dsh-bot.id": target.id,
      "user.dsh-bot.owner": "b",
    })
    await expect(volume.environment.ensure(target)).rejects.toThrow(
      `the workspace volume "${volumeName}" exists but was not created by this installation`,
    )
    expect(volume.h.incus.log).toEqual([])

    const stateless = setup()
    await stateless.environment.ensure(target)
    await stateless.h.files.api.remove(`${dir}/state.json`)
    await expect(stateless.environment.ensure(target)).rejects.toThrow("its state under")
  })

  it("refuses bot ids that cannot name an instance", async () => {
    const { environment } = setup()
    await expect(environment.ensure({ ...target, id: "../x" })).rejects.toThrow("cannot name")
    await expect(environment.remove("a b")).rejects.toThrow("cannot name")
  })

  it("removes its VM, keys and managed ssh config at once, and marks the workspace volume for later deletion", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    h.clock.now = 5_000
    await environment.remove(target.id)
    expect(h.incus.instances.size).toBe(0)
    expect([...h.files.files.keys()]).toEqual([])
    expect(h.incus.volumes.get(`dsh/${volumeName}`)?.config["user.dsh-bot.orphaned"]).toBe(
      new Date(5_000).toISOString(),
    )
    await environment.remove(target.id)
  })

  it("leaves a foreign instance, a foreign volume and an unmanaged ssh config alone on remove", async () => {
    const { h, environment } = setup()
    h.incus.foreign(alias, { "user.dsh-bot.id": target.id, "user.dsh-bot.owner": "b" })
    h.incus.foreignVolume(volumeName, {
      size: "1GiB",
      "user.dsh-bot.id": target.id,
      "user.dsh-bot.owner": "b",
    })
    await h.files.api.write("/state/ssh/1a2b3c4d.conf", "Host mine\n", 0o600)
    await environment.remove(target.id)
    expect(h.incus.instances.has(alias)).toBe(true)
    expect(h.incus.volumes.get(`dsh/${volumeName}`)?.config).not.toHaveProperty(
      "user.dsh-bot.orphaned",
    )
    expect(h.files.files.has("/state/ssh/1a2b3c4d.conf")).toBe(true)
  })

  it("links DSH's ripgrep path to the VM's ripgrep after the VM is ready", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const link = sshCommands(h)[2]
    expect(link?.at(-2)).toBe(alias)
    expect(link?.at(-1)).toBe(
      [
        "test -x '/usr/bin/rg' || { echo \"/usr/bin/rg is missing in the VM\" >&2; exit 3; }",
        `[ "$(readlink -- '${HOST_RG}')" = '/usr/bin/rg' ] && exit 0`,
        `sudo -n install -d -m 0755 -- "$(dirname -- '${HOST_RG}')" && sudo -n ln -sfn -- '/usr/bin/rg' '${HOST_RG}'`,
      ].join("; "),
    )
  })

  it("fails ensure when the ripgrep link cannot be made", async () => {
    const { h, environment } = setup()
    h.probe = [0, 0, 1]
    await expect(environment.ensure(target)).rejects.toThrow(
      `cannot link DSH's ripgrep ${HOST_RG} to /usr/bin/rg in ${alias} (exit 1)`,
    )
  })

  it("opens sshd -i only in a running VM it created for a bot", async () => {
    const { h, environment } = setup()
    const execs: string[] = []
    h.incus.client.exec = async (name, request) => {
      execs.push(`${name} ${request.command.join(" ")} ${request.user}`)
      return {} as never
    }
    await environment.ensure(target)
    await environment.openGuest(alias)
    expect(execs).toEqual([`${alias} /usr/sbin/sshd -i 0`])
    h.incus.foreign("dsh-bot-feed0001", {
      "user.dsh-bot.id": "feed0001",
      "user.dsh-bot.owner": "b",
    })
    await expect(environment.openGuest("dsh-bot-feed0001")).rejects.toThrow(
      "not a bot VM of this installation",
    )
    await expect(environment.openGuest("other-vm")).rejects.toThrow("not a bot VM")
    await expect(environment.openGuest("x; rm")).rejects.toThrow("not an Incus instance name")
    await h.incus.client.setState(alias, "stop")
    await expect(environment.openGuest(alias)).rejects.toThrow("is Stopped")
  })

  it("asks bot-core to ensure again a healthy bot whose VM stopped, not one whose ensure fails", async () => {
    const { h, environment } = setup()
    const changes: string[] = []
    environment.onChange((botId) => changes.push(botId))
    await environment.ensure(target)
    await environment.poll()
    expect(changes).toEqual([])
    await h.incus.client.setState(alias, "stop")
    await environment.poll()
    expect(changes).toEqual([target.id])

    const failing = setup({ probe: Array(50).fill(255) })
    const none: string[] = []
    failing.environment.onChange((botId) => none.push(botId))
    await expect(failing.environment.ensure(target)).rejects.toThrow()
    await failing.h.incus.client.setState(alias, "stop")
    await failing.environment.poll()
    expect(none).toEqual([])
  })

  it("stops and marks VMs and volumes of deleted bots, deletes them after the grace period", async () => {
    const { h, environment } = setup()
    const old = { id: "deadbeef", name: "Old", spec: SPEC }
    const listed = { id: "cafe0001", name: "Kept", spec: SPEC }
    await environment.ensure(old)
    await environment.ensure(listed)
    h.incus.foreign("dsh-bot-feed0001", {
      "user.dsh-bot.id": "feed0001",
      "user.dsh-bot.owner": "b",
    })
    h.incus.foreignVolume("dsh-bot-feed0001-workspace", {
      size: "1GiB",
      "user.dsh-bot.id": "feed0001",
      "user.dsh-bot.owner": "b",
    })

    const fresh = setup({ incus: h.incus, files: h.files, clock: h.clock })
    h.clock.now = 1_000
    expect(await fresh.environment.reconcile([listed.id])).toEqual({
      marked: [old.id],
      removed: [],
    })
    expect(h.incus.instances.get("dsh-bot-deadbeef")).toMatchObject({
      status: "Stopped",
      config: { "user.dsh-bot.orphaned": new Date(1_000).toISOString() },
    })
    expect(
      h.incus.volumes.get("dsh/dsh-bot-deadbeef-workspace")?.config["user.dsh-bot.orphaned"],
    ).toBe(new Date(1_000).toISOString())
    h.clock.now = 1_000 + 7 * DAY
    expect(await fresh.environment.reconcile([listed.id])).toEqual({
      marked: [],
      removed: [old.id],
    })
    expect(h.incus.instances.has("dsh-bot-deadbeef")).toBe(false)
    expect(h.incus.volumes.has("dsh/dsh-bot-deadbeef-workspace")).toBe(false)
    expect(h.files.dirs.has("/state/bots/deadbeef")).toBe(false)
    expect(h.incus.instances.has("dsh-bot-cafe0001")).toBe(true)
    expect(h.incus.instances.has("dsh-bot-feed0001")).toBe(true)
    expect(h.incus.volumes.has("dsh/dsh-bot-feed0001-workspace")).toBe(true)
  })

  it("deletes a removed bot's volume after the grace period, never one still attached", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    await environment.remove(target.id)
    h.clock.now = 7 * DAY - 1
    expect(await environment.reconcile([])).toEqual({ marked: [], removed: [] })
    h.clock.now = 7 * DAY
    expect(await environment.reconcile([])).toEqual({ marked: [], removed: [target.id] })
    expect(h.incus.volumes.size).toBe(0)

    const attached = setup()
    await attached.environment.ensure(target)
    must(attached.h.incus.volumes.get(`dsh/${volumeName}`)).config["user.dsh-bot.orphaned"] =
      new Date(0).toISOString()
    const later = setup({
      incus: attached.h.incus,
      files: attached.h.files,
      clock: { now: 30 * DAY },
    })
    must(attached.h.incus.instances.get(alias)).config["user.dsh-bot.orphaned"] = new Date(
      29 * DAY,
    ).toISOString()
    await later.environment.reconcile([])
    expect(attached.h.incus.volumes.has(`dsh/${volumeName}`)).toBe(true)
  })

  it("clears the orphan marks of a bot that turns out to exist", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    await environment.remove(target.id)
    await environment.ensure(target)
    expect(h.incus.volumes.get(`dsh/${volumeName}`)?.config["user.dsh-bot.orphaned"]).toBe("")
    must(h.incus.instances.get(alias)).config["user.dsh-bot.orphaned"] = new Date(0).toISOString()
    await environment.reconcile([target.id])
    expect(h.incus.instances.get(alias)?.config["user.dsh-bot.orphaned"]).toBe("")
  })
})

describe("incus-vm environment: the bot's spec", () => {
  it("stops a running VM whose CPUs or memory differ, changes it and starts it again", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    h.incus.log.length = 0
    await environment.ensure({ ...target, spec: { ...SPEC, cpus: 6 } })
    expect(h.incus.log).toEqual([
      `stop ${alias}`,
      `update ${alias} ${JSON.stringify({ config: { "limits.cpu": "6" } })}`,
      `start ${alias}`,
    ])
  })

  it("grows the workspace volume only while the VM is stopped, and never shrinks it", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    h.incus.log.length = 0
    await environment.ensure({ ...target, spec: { ...SPEC, diskGiB: 30 } })
    expect(h.incus.log).toEqual([
      `stop ${alias}`,
      `volume patch ${volumeName} ${JSON.stringify({ size: "30GiB" })}`,
      `start ${alias}`,
    ])
    h.incus.log.length = 0
    await expect(environment.ensure({ ...target, spec: { ...SPEC, diskGiB: 20 } })).rejects.toThrow(
      `the workspace volume "${volumeName}" is 30GiB; it cannot shrink to 20GiB`,
    )
    expect(h.incus.log).toEqual([])
  })

  it("rewrites memory written another way without a restart", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    must(h.incus.instances.get(alias)).config["limits.memory"] = "6GiB"
    h.incus.log.length = 0
    await environment.ensure(target)
    expect(h.incus.log).toEqual([
      `update ${alias} ${JSON.stringify({ config: { "limits.memory": "6144MiB" } })}`,
    ])
  })

  it("writes the layout into a VM that lacks part of it, restarting it", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const instance = must(h.incus.instances.get(alias))
    const { eth0: _, ...devices } = instance.devices
    h.incus.instances.set(alias, { ...instance, devices })
    h.incus.log.length = 0
    await environment.ensure(target)
    expect(h.incus.log[0]).toBe(`stop ${alias}`)
    expect(h.incus.instances.get(alias)?.devices.eth0).toEqual(LAYOUT.devices.eth0)
  })

  it("starts a VM it stopped again when Incus refuses the change, and fails the ensure", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    h.incus.client.update = async () => {
      throw new Error("refused")
    }
    h.incus.log.length = 0
    await expect(environment.ensure({ ...target, spec: { ...SPEC, cpus: 6 } })).rejects.toThrow(
      "refused",
    )
    expect(h.incus.log).toEqual([`stop ${alias}`, `start ${alias}`])
  })

  it("inspects what a bot's VM and volume run with, and nothing for a bot without one", async () => {
    const { environment } = setup()
    expect(await environment.inspect(target.id)).toBeUndefined()
    await environment.ensure(target)
    expect(await environment.inspect(target.id)).toEqual(SPEC)
  })

  it("reads its capacity from the server and the project's limits, the workspace beside the root disk", async () => {
    const { h, environment } = setup()
    h.incus.host.project = { ...PROJECT, "limits.cpu": "6", "limits.disk.pool.dsh": "60GiB" }
    await environment.ensure({ id: "cafe0001", name: "Other", spec: { ...SPEC, memoryMiB: 8192 } })
    expect(await environment.capacity(target.id)).toEqual({
      cpus: { min: 1, max: 6, step: 1 },
      memoryMiB: { min: 1024, max: 48 * 1024, step: 512 },
      diskGiB: { min: 1, max: 60 - 16, step: 1, growOnly: true },
    })
  })
})

describe("reconfigure", () => {
  const instance = (patch: Partial<IncusInstance> = {}): IncusInstance => ({
    name: alias,
    status: "Running",
    config: { ...LAYOUT.config },
    devices: structuredClone(LAYOUT.devices) as IncusInstance["devices"],
    ...patch,
  })

  it("changes nothing for an instance that has the layout", () => {
    expect(reconfigure(instance(), LAYOUT)).toEqual({ restarts: false, change: undefined })
  })

  it("restarts for a device or a value that differs, not for one written differently", () => {
    expect(
      reconfigure(instance({ config: { ...LAYOUT.config, "limits.cpu": "2" } }), LAYOUT).restarts,
    ).toBe(true)
    expect(
      reconfigure(instance({ config: { ...LAYOUT.config, "limits.memory": "6GiB" } }), LAYOUT),
    ).toEqual({
      restarts: false,
      change: { config: { "limits.memory": "6144MiB" } },
    })
  })

  it("refuses to shrink the root disk", () => {
    const larger = instance()
    const devices = { ...larger.devices, root: { ...larger.devices.root, size: "32GiB" } }
    expect(() => reconfigure({ ...larger, devices } as IncusInstance, LAYOUT)).toThrow(
      "cannot shrink to 16GiB",
    )
  })
})

describe("workspace volume plan", () => {
  const volume = (size: string): WorkspaceRecord => ({
    name: volumeName,
    botId: target.id,
    owner: "owner-a",
    orphanedSince: undefined,
    block: true,
    sizeBytes: sizeBytesOf(size),
    sizeText: size,
    attached: false,
  })
  it("creates, keeps, grows and never shrinks", () => {
    expect(volumePlan(undefined, 20, () => true)).toEqual({ kind: "create" })
    expect(volumePlan(volume("20GiB"), 20, () => true)).toEqual({ kind: "keep" })
    expect(volumePlan(volume("20GiB"), 25, () => true)).toEqual({ kind: "grow", sizeGiB: 25 })
    expect(() => volumePlan(volume("20GiB"), 10, () => true)).toThrow("cannot shrink")
    expect(() => volumePlan(volume("20GiB"), 20, () => false)).toThrow(
      "not created by this installation",
    )
  })
})

describe("Incus sizes", () => {
  it("reads sizes with or without a unit, and nothing it cannot read", () => {
    expect(sizeBytesOf("4GiB")).toBe(4 * 1024 ** 3)
    expect(sizeBytesOf("4096MiB")).toBe(4 * 1024 ** 3)
    expect(sizeBytesOf("1GB")).toBe(1e9)
    expect(sizeBytesOf("512")).toBe(512)
    expect(sizeBytesOf("50%")).toBeUndefined()
    expect(sizeBytesOf(undefined)).toBeUndefined()
  })
})
