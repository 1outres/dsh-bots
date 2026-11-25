import { describe, expect, it, vi } from "vitest"
import {
  type CommandResult,
  createVmEnvironment,
  type EnvironmentDeps,
  type EnvironmentFiles,
  type EnvironmentSettings,
} from "../src/host/environment"
import type { IncusClient, IncusInstance, InstanceSpec, StateAction } from "../src/host/incus"
import { reconfigure } from "../src/host/reconfigure"
import { sizeBytesOf } from "../src/host/spec"
import { incusWith } from "./support/incus"

const DAY = 24 * 3_600_000

const settings: EnvironmentSettings = {
  stateDir: "/state",
  owner: "owner-a",
  orphanGraceMs: 7 * DAY,
  instancePrefix: "dsh-bot-",
  hostAliasPrefix: "dsh-bot-",
  image: "dsh-bot-base",
  profiles: ["dsh-bot"],
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
  hostRoot: "/share",
  hostUid: 1000,
  hostGid: 1000,
  guestUid: 1001,
  guestGid: 1001,
}

const IDMAP = "uid 1000 1001\ngid 1000 1001"
const HOST_RG = "/opt/dsh/node_modules/@vscode/ripgrep/bin/rg"
const TOOLS = {
  hostRipgrep: async () => HOST_RG,
}
const proxyOf = (name: string) => `/node /lib/guest-proxy.js /state/run/guest.sock ${name}`
const SECURE_MOUNT = async () => ({
  target: "/share",
  options: ["rw", "nosuid", "nodev", "nosymfollow"],
})

const SPEC = { cpus: 4, memoryMiB: 6144, diskGiB: 20 }
const target = { id: "1a2b3c4d", name: "Ada", spec: SPEC }
const alias = "dsh-bot-1a2b3c4d"
const dir = "/state/bots/1a2b3c4d"

type FakeInstance = IncusInstance & { config: Record<string, string> }

/** The config and root disk the fake profiles give every instance. */
const PROFILE_CONFIG: Readonly<Record<string, string>> = {
  "limits.cpu": "2",
  "limits.memory": "2GiB",
}
const PROFILE_ROOT = { type: "disk", path: "/", pool: "dsh", size: "10GiB" }
const ROOT = (size: string) => ({ ...PROFILE_ROOT, size })
/** The own config and root disk ensure writes for {@link SPEC}. */
const PINNED = {
  config: { "limits.cpu": "4", "limits.memory": "6144MiB" },
  devices: { root: ROOT("20GiB") },
}

function fakeIncus() {
  const instances = new Map<string, FakeInstance>()
  const log: string[] = []
  const created: InstanceSpec[] = []
  const expanded = (instance: FakeInstance): FakeInstance => ({
    ...structuredClone(instance),
    expanded_config: { ...PROFILE_CONFIG, ...instance.config },
    expanded_devices: { root: PROFILE_ROOT, ...structuredClone(instance.devices) },
  })
  const host = {
    resources: { cpus: 8, memoryBytes: 64 * 1024 ** 3 },
    project: { "limits.memory": "56GiB" } as Record<string, string>,
    poolBytes: 80 * 1024 ** 3,
  }
  const client: IncusClient = incusWith({
    async instance(name) {
      const found = instances.get(name)
      return found === undefined ? undefined : expanded(found)
    },
    async instances() {
      return [...instances.values()].map(expanded)
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
      const config = { ...found.config, ...change.config }
      instances.set(name, {
        ...found,
        config,
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
    hostResources: async () => host.resources,
    projectConfig: async () => host.project,
    profile: async (name) =>
      name === "dsh-bot" ? { name, devices: { root: PROFILE_ROOT } } : undefined,
    poolSpace: async () => host.poolBytes,
  })
  /** An instance some other tool or installation created under a bot's name. */
  const foreign = (name: string, config: Record<string, string> = {}) =>
    instances.set(name, { name, status: "Running", config, devices: {} })
  return { client, instances, log, created, foreign, host }
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
  /** Exit codes the readiness probe returns, in order (then 0). */
  probe: number[]
  /** Options of the mount the share lies on. */
  mount?: readonly string[]
}

function setup(overrides: Partial<Harness> = {}, patch: Partial<EnvironmentDeps> = {}) {
  const h: Harness = {
    incus: fakeIncus(),
    files: fakeFiles(),
    commands: [],
    clock: { now: 0 },
    probe: [],
    ...overrides,
  }
  const environment = createVmEnvironment(settings, {
    incus: h.incus.client,
    files: h.files.api,
    ...TOOLS,
    mountOf: async () => ({
      target: "/share",
      options: h.mount ?? ["rw", "nosuid", "nodev"],
    }),
    async run(file, args): Promise<CommandResult> {
      h.commands.push([file, ...args])
      if (file === "ssh-keygen" && args[0] === "-y") {
        const path = args[2] as string
        return { code: 0, stdout: `ssh-ed25519 PUB${path.length}\n`, stderr: "" }
      }
      if (file === "ssh-keygen") {
        const path = args[args.indexOf("-f") + 1] as string
        await h.files.api.write(path, `PRIVATE ${path}`, 0o600)
        await h.files.api.write(`${path}.pub`, `ssh-ed25519 PUB${path.length} ${args[6]}\n`, 0o644)
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
  })
  return { h, environment }
}

describe("incus-vm environment", () => {
  it("declares its id, workspace and the services bot-core must isolate", () => {
    const { environment } = setup()
    expect(environment.id).toBe("incus-vm")
    expect(environment.workspace).toBe("/home/bot/workspace")
    expect(environment.isolate).toEqual(["ssh", "fs", "subprocess", "shell", "sandboxPolicy"])
  })

  it("refuses prefixes that cannot name an instance or an ssh host", () => {
    const deps = setup()
    const make = (patch: Partial<EnvironmentSettings>) => () =>
      createVmEnvironment(
        { ...settings, ...patch },
        {
          incus: deps.h.incus.client,
          files: deps.h.files.api,
          ...TOOLS,
          mountOf: SECURE_MOUNT,
          run: async () => ({ code: 0, stdout: "", stderr: "" }),
          sleep: async () => {},
          now: () => 0,
          log: () => {},
        },
      )
    expect(make({ instancePrefix: "1bot-" })).toThrow("instancePrefix")
    expect(make({ hostAliasPrefix: "-x" })).toThrow("hostAliasPrefix")
    expect(make({ owner: "" })).toThrow("owner")
    for (const workspace of ["relative", "/", "/a/../b", "/a/", "/a//b"]) {
      expect(make({ workspace })).toThrow("canonical")
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
          launch: { kind: "node-script", node: "/usr/bin/node" },
          helper: "/opt/helper.js",
          helperHash: "a".repeat(64),
          workspace: "/home/bot/workspace",
          requestTimeoutMs: 30_000,
          configFile: "/state/ssh/1a2b3c4d.conf",
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

  it("creates an owned VM with keys, cloud-init and an ssh config, then waits for SSH", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)

    expect(h.incus.log).toEqual([
      `create ${alias}`,
      `update ${alias} ${JSON.stringify(PINNED)}`,
      `start ${alias}`,
    ])
    const spec = h.incus.created[0] as InstanceSpec
    expect(spec.image).toBe("dsh-bot-base")
    expect(spec.profiles).toEqual(["dsh-bot"])
    expect(spec.start).toBe(false)
    expect(spec.config).toMatchObject({
      "boot.autostart": "true",
      "security.guestapi": "false",
      "user.dsh-bot.id": target.id,
      "user.dsh-bot.owner": "owner-a",
    })
    expect(spec.config).not.toHaveProperty("user.dsh-bot.path")
    expect(spec.config["raw.idmap"]).toBe(IDMAP)
    expect(spec.devices).toEqual({
      workspace: {
        type: "disk",
        source: "/share/1a2b3c4d/workspace",
        path: "/home/bot/workspace",
        "io.bus": "virtiofs",
      },
    })
    expect(h.files.dirs.get("/share")).toBe(0o700)
    expect(h.files.dirs.get("/share/1a2b3c4d")).toBe(0o700)
    expect(h.files.dirs.get("/share/1a2b3c4d/workspace")).toBe(0o755)

    const userData = spec.config["cloud-init.user-data"] as string
    expect(userData.startsWith("#cloud-config\n")).toBe(true)
    const document = JSON.parse(userData.slice("#cloud-config\n".length))
    expect(document.users[0].name).toBe("bot")
    expect(document.users[0].ssh_authorized_keys).toEqual([
      `ssh-ed25519 PUB${`${dir}/id_ed25519`.length} ${alias}`,
    ])
    expect(document.ssh_keys.ed25519_private).toBe(`PRIVATE ${dir}/ssh_host_ed25519_key`)
    expect(document.bootcmd).toBeUndefined()
    expect(document.runcmd[0].slice(-2)).toEqual(["/home/bot/workspace", "bot"])
    expect(userData).not.toContain("mount")

    const conf = h.files.files.get("/state/ssh/1a2b3c4d.conf")
    expect(conf?.mode).toBe(0o600)
    expect(conf?.content.startsWith("# Managed by @1outres/dsh-bot-vm")).toBe(true)
    for (const line of [
      `Host ${alias}`,
      `ProxyCommand ${proxyOf(alias)}`,
      "ProxyUseFdpass no",
      `IdentityFile ${dir}/id_ed25519`,
      `UserKnownHostsFile ${dir}/known_hosts`,
      `HostKeyAlias ${alias}`,
      "User bot",
      "IdentitiesOnly yes",
    ]) {
      expect(conf?.content).toContain(`${line}\n`)
    }
    expect(h.files.files.get(`${dir}/known_hosts`)).toEqual({
      content: `${alias} ssh-ed25519 PUB${`${dir}/ssh_host_ed25519_key`.length}\n`,
      mode: 0o600,
    })
    expect(h.files.dirs.get(dir)).toBe(0o700)
    expect(h.files.dirs.get("/state/ssh")).toBe(0o700)
    const probe = h.commands.find((command) => command[0] === "ssh")
    expect(probe).toEqual([
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
      "test -e /var/lib/cloud/instance/boot-finished && test -d '/home/bot/workspace' && test -w '/home/bot/workspace'",
    ])
    expect(JSON.parse(h.files.files.get(`${dir}/state.json`)?.content ?? "{}")).toEqual({
      version: 1,
    })
    // Then the helper starts once, as a session's connection will, so its first
    // handshake does not read everything cold (E2E: the first turn failed on it).
    const sshCommands = h.commands.filter((command) => command[0] === "ssh")
    expect(sshCommands).toHaveLength(3)
    expect(sshCommands[1]?.slice(-2)).toEqual([
      alias,
      "cd '/home/bot/workspace' && '/usr/bin/node' --disable-sigusr1 '/opt/helper.js' </dev/null >/dev/null 2>&1; exit 0",
    ])
  })

  it("warms the helper up with a generous deadline and never fails ensure on it", async () => {
    const timeouts: (number | undefined)[] = []
    const logs: string[] = []
    let calls = 0
    const files = fakeFiles()
    const environment = createVmEnvironment(settings, {
      incus: fakeIncus().client,
      files: files.api,
      ...TOOLS,
      mountOf: SECURE_MOUNT,
      async run(file, args, options) {
        if (file === "ssh-keygen") {
          const path = args[args.indexOf("-f") + 1] as string
          await files.api.write(path, `PRIVATE ${path}`, 0o600)
          await files.api.write(`${path}.pub`, "ssh-ed25519 PUB c\n", 0o644)
          return { code: 0, stdout: "", stderr: "" }
        }
        calls++
        timeouts.push(options?.timeoutMs)
        // The readiness probe answers; the warm-up times out; the ripgrep link is made.
        return calls === 2
          ? { code: 255, stdout: "", stderr: "timed out" }
          : { code: 0, stdout: "", stderr: "" }
      },
      sleep: async () => {},
      now: () => 0,
      log: (message) => logs.push(message),
    })
    await environment.ensure(target)
    expect(timeouts).toEqual([30_000, 120_000, 30_000])
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

  it("reports queued while every provisioning slot is taken", async () => {
    const { h, environment } = setup()
    const create = h.incus.client.create
    const gates: (() => void)[] = []
    h.incus.client.create = async (spec, signal) => {
      await new Promise<void>((resolve) => gates.push(resolve))
      await create(spec, signal)
    }
    const steps = new Map<string, string[]>()
    const ensure = (id: string) => {
      const seen: string[] = []
      steps.set(id, seen)
      return environment.ensure(
        { id, name: id, spec: SPEC },
        { progress: (phase) => seen.push(phase) },
      )
    }
    const all = Promise.all(["b0000001", "b0000002", "b0000003"].map(ensure))
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    expect(steps.get("b0000003")).toEqual(["queued"])
    for (const gate of gates.splice(0)) gate()
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    expect(steps.get("b0000003")).toEqual(["queued", "creating"])
    gates[0]?.()
    await all
  })

  it("skips creating and booting for a VM that runs, and boots a stopped one", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const steps: string[] = []
    await environment.ensure(target, { progress: (phase) => steps.push(phase) })
    expect(steps).toEqual(["connecting"])
    const instance = h.incus.instances.get(alias) as FakeInstance
    h.incus.instances.set(alias, { ...instance, status: "Stopped" })
    steps.length = 0
    await environment.ensure(target, { progress: (phase) => steps.push(phase) })
    expect(steps).toEqual(["queued", "booting", "connecting"])
  })

  it("keeps a VM provisioned by an older version (path tag, seeded state)", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const instance = h.incus.instances.get(alias)
    if (instance !== undefined) instance.config["user.dsh-bot.path"] = "/home/u/.dsh/bots/x"
    await h.files.api.write(`${dir}/state.json`, '{"version":1,"seeded":true}\n', 0o600)
    h.incus.log.length = 0
    await environment.ensure(target)
    expect(h.incus.log).toEqual([])
  })

  it("adds the share to a VM of an earlier version, restarting it", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const instance = h.incus.instances.get(alias) as FakeInstance
    h.incus.instances.set(alias, { ...instance, devices: { root: ROOT("20GiB") } })
    delete instance.config["raw.idmap"]
    h.incus.log.length = 0
    await environment.ensure(target)
    expect(h.incus.log).toEqual([
      `stop ${alias}`,
      `update ${alias} ${JSON.stringify({
        config: { "raw.idmap": IDMAP },
        devices: {
          workspace: {
            type: "disk",
            source: "/share/1a2b3c4d/workspace",
            path: "/home/bot/workspace",
            "io.bus": "virtiofs",
          },
        },
      })}`,
      `start ${alias}`,
    ])
    // A stopped one with another share source: no stop, patched, started.
    const updated = h.incus.instances.get(alias) as FakeInstance
    h.incus.instances.set(alias, {
      ...updated,
      status: "Stopped",
      devices: {
        workspace: {
          type: "disk",
          source: "/elsewhere",
          path: "/home/bot/workspace",
        },
        root: ROOT("20GiB"),
      },
    })
    h.incus.log.length = 0
    await environment.ensure(target)
    expect(h.incus.log.map((line) => line.split(" ")[0])).toEqual(["update", "start"])
    h.incus.log.length = 0
    await environment.ensure(target)
    expect(h.incus.log).toEqual([])
  })

  it("refuses to share from a mount without nosuid,nodev and never maps root", async () => {
    const unsafe = setup({ mount: ["rw", "nosuid", "relatime"] })
    await expect(unsafe.environment.ensure(target)).rejects.toThrow(
      "/share/1a2b3c4d/workspace lies on the mount /share without nodev",
    )
    expect(unsafe.h.incus.log).toEqual([])
    const deps = setup().h
    const make = (patch: Partial<EnvironmentSettings>) =>
      createVmEnvironment(
        { ...settings, ...patch },
        {
          incus: deps.incus.client,
          files: deps.files.api,
          ...TOOLS,
          mountOf: SECURE_MOUNT,
          run: async () => ({ code: 0, stdout: "", stderr: "" }),
          sleep: async () => {},
          now: () => 0,
          log: () => {},
        },
      )
    expect(() => make({ hostRoot: "rel" })).toThrow("hostRoot")
    for (const patch of [{ hostUid: 0 }, { guestGid: 0 }, { hostGid: -1 }]) {
      await expect(make(patch).ensure(target)).rejects.toThrow("non-root")
    }
    expect(deps.incus.log).toEqual([])
  })

  it("starts a stopped VM and keeps its keys", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const keygens = h.commands.filter((command) => command[0] === "ssh-keygen").length
    await h.incus.client.setState(alias, "stop")
    h.incus.log.length = 0
    await environment.ensure(target)
    expect(h.incus.log).toEqual([`start ${alias}`])
    expect(h.commands.filter((command) => command[0] === "ssh-keygen")).toHaveLength(keygens)
  })

  it("derives a lost public key again and never replaces a private key the VM holds", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    await h.files.api.remove(`${dir}/id_ed25519.pub`)
    await environment.ensure(target)
    expect(h.commands).toContainEqual(["ssh-keygen", "-y", "-f", `${dir}/id_ed25519`])
    expect(h.files.files.get(`${dir}/id_ed25519.pub`)?.content).toBe(
      `ssh-ed25519 PUB${`${dir}/id_ed25519`.length} ${alias}\n`,
    )
    await h.files.api.remove(`${dir}/id_ed25519`)
    await expect(environment.ensure(target)).rejects.toThrow("is missing while its VM exists")
  })

  it("creates at most maxConcurrentProvisions VMs at once", async () => {
    const { h, environment } = setup()
    let active = 0
    let peak = 0
    const create = h.incus.client.create
    h.incus.client.create = async (spec, signal) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      await create(spec, signal)
      active--
    }
    const bots = ["b0000001", "b0000002", "b0000003", "b0000004"].map((id) => ({
      id,
      name: id,
      spec: SPEC,
    }))
    await Promise.all(bots.map((bot) => environment.ensure(bot)))
    expect(h.incus.created).toHaveLength(4)
    expect(peak).toBe(2)
  })

  it("serializes concurrent ensures of one bot", async () => {
    const { h, environment } = setup()
    await Promise.all([environment.ensure(target), environment.ensure(target)])
    expect(h.incus.log.filter((line) => line.startsWith("create"))).toEqual([`create ${alias}`])
  })

  it("waits until SSH answers and the workspace is writable, then gives up", async () => {
    const { h, environment } = setup({ probe: [255, 32, 255] })
    await environment.ensure(target)
    expect(h.clock.now).toBe(3_000)

    const slow = setup({ probe: Array(50).fill(255) })
    await expect(slow.environment.ensure(target)).rejects.toThrow(
      `the bot VM (${alias}) is not ready within 10000 ms: it did not answer over SSH: Connection refused`,
    )
    const unwritable = setup({ probe: Array(50).fill(1) })
    await expect(unwritable.environment.ensure(target)).rejects.toThrow(
      "answers over SSH but cloud-init has not finished or /home/bot/workspace is not a directory bot can write (exit 1)",
    )
  })

  it("does not adopt an instance it did not create, or one missing its state", async () => {
    const foreign = setup()
    foreign.h.incus.foreign(alias)
    await expect(foreign.environment.ensure(target)).rejects.toThrow(
      "was not created by this installation",
    )
    const otherOwner = setup()
    otherOwner.h.incus.foreign(alias, { "user.dsh-bot.id": target.id, "user.dsh-bot.owner": "b" })
    await expect(otherOwner.environment.ensure(target)).rejects.toThrow("owner differs")
    expect(otherOwner.h.incus.log).toEqual([])

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

  it("removes its own VM, keys and managed ssh config", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    await environment.remove(target.id)
    expect(h.incus.instances.size).toBe(0)
    expect([...h.files.files.keys()]).toEqual([])
    // The shared workspace stays on the Host.
    expect(h.files.dirs.has("/share/1a2b3c4d/workspace")).toBe(true)
    await environment.remove(target.id)
  })

  it("leaves a foreign instance and an unmanaged ssh config alone on remove", async () => {
    const { h, environment } = setup()
    h.incus.foreign(alias, { "user.dsh-bot.id": target.id, "user.dsh-bot.owner": "b" })
    await h.files.api.write("/state/ssh/1a2b3c4d.conf", "Host mine\n", 0o600)
    await environment.remove(target.id)
    expect(h.incus.instances.has(alias)).toBe(true)
    expect(h.files.files.has("/state/ssh/1a2b3c4d.conf")).toBe(true)
  })

  it("provisions again after its VM was deleted outside", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    await h.incus.client.destroy(alias)
    await environment.ensure(target)
    expect(h.incus.log.filter((line) => line.startsWith("create"))).toHaveLength(2)
  })

  it("relays SSH through the package's guest proxy and this process's relay, without fd passing", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const conf = h.files.files.get("/state/ssh/1a2b3c4d.conf")?.content
    expect(conf).toContain(`  ProxyCommand ${proxyOf(alias)}\n`)
    expect(conf).toContain("  ProxyUseFdpass no\n")
  })

  it("links DSH's ripgrep path to the VM's ripgrep after the VM is ready", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const link = h.commands.filter((command) => command[0] === "ssh")[2]
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

  it("asks bot-core to ensure again a healthy bot whose VM stopped", async () => {
    const { h, environment } = setup()
    const changes: string[] = []
    environment.onChange((botId) => changes.push(botId))
    await environment.ensure(target)
    await environment.poll()
    expect(changes).toEqual([])
    await h.incus.client.setState(alias, "stop")
    await environment.poll()
    expect(changes).toEqual([target.id])
  })

  it("does not poll a bot whose ensure is failing (bot-core backs off)", async () => {
    const { h, environment } = setup({ probe: Array(50).fill(255) })
    const changes: string[] = []
    environment.onChange((botId) => changes.push(botId))
    await expect(environment.ensure(target)).rejects.toThrow()
    await h.incus.client.setState(alias, "stop")
    await environment.poll()
    expect(changes).toEqual([])
  })

  it("stops and marks VMs of deleted bots, deletes them after the grace period", async () => {
    const { h, environment } = setup()
    const old = { id: "deadbeef", name: "Old", spec: SPEC }
    const listed = { id: "cafe0001", name: "Kept", spec: SPEC }
    await environment.ensure(old)
    await environment.ensure(listed)
    h.incus.foreign("dsh-bot-feed0001", {
      "user.dsh-bot.id": "feed0001",
      "user.dsh-bot.owner": "b",
    })
    h.incus.foreign("dsh-bot-demo")
    await h.files.api.write("/state/ssh/bot-demo.conf", "Host bot-demo\n", 0o600)

    // A fresh process: nothing ensured yet except the bot being created now.
    const fresh = setup(h).environment
    await fresh.ensure(target)
    expect(await fresh.reconcile([listed.id])).toEqual({ marked: [old.id], removed: [] })
    const marked = h.incus.instances.get("dsh-bot-deadbeef")
    expect(marked?.status).toBe("Stopped")
    expect(marked?.config["user.dsh-bot.orphaned"]).toBe(new Date(0).toISOString())

    h.clock.now += 6 * DAY
    expect(await fresh.reconcile([listed.id])).toEqual({ marked: [], removed: [] })
    h.clock.now += 2 * DAY
    expect(await fresh.reconcile([listed.id])).toEqual({ marked: [], removed: [old.id] })

    expect([...h.incus.instances.keys()].sort()).toEqual([
      alias,
      "dsh-bot-cafe0001",
      "dsh-bot-demo",
      "dsh-bot-feed0001",
    ])
    expect([...h.files.files.keys()].some((path) => path.includes("deadbeef"))).toBe(false)
    expect(h.files.dirs.has("/share/deadbeef/workspace")).toBe(true)
    expect(h.files.files.has("/state/ssh/cafe0001.conf")).toBe(true)
    expect(h.files.files.has("/state/ssh/bot-demo.conf")).toBe(true)
  })

  it("clears the orphan mark of a bot that turns out to exist", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const fresh = setup(h).environment
    await fresh.reconcile([])
    expect(h.incus.instances.get(alias)?.config["user.dsh-bot.orphaned"]).not.toBe("")
    await fresh.ensure(target)
    expect(h.incus.instances.get(alias)?.config["user.dsh-bot.orphaned"]).toBe("")
    expect(h.incus.instances.get(alias)?.status).toBe("Running")
  })
})

describe("incus-vm environment: the bot's spec", () => {
  const vm = "dsh-bot-1a2b3c4d"
  const setStatus = (h: Harness, status: string) => {
    const instance = h.incus.instances.get(vm) as FakeInstance
    h.incus.instances.set(vm, { ...instance, status })
  }
  /** An instance of an earlier version: only the profiles' CPUs and disk, its own memory. */
  const earlier = (h: Harness, status = "Running") => {
    const instance = h.incus.instances.get(vm) as FakeInstance
    const { root: _root, ...devices } = instance.devices
    const { "limits.cpu": _cpu, ...config } = instance.config
    h.incus.instances.set(vm, {
      ...instance,
      status,
      config: { ...config, "limits.memory": "4096MiB" },
      devices,
    })
  }

  it("creates a VM stopped, gives it the spec in its own config and root disk, then starts it", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const instance = h.incus.instances.get(vm)
    expect(instance?.config).toMatchObject({ "limits.cpu": "4", "limits.memory": "6144MiB" })
    expect(instance?.devices.root).toEqual(ROOT("20GiB"))
    expect(h.incus.log.indexOf(`update ${vm} ${JSON.stringify(PINNED)}`)).toBeLessThan(
      h.incus.log.indexOf(`start ${vm}`),
    )
  })

  it("stops a running VM whose spec differs, changes it and starts it again", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    h.incus.log.length = 0
    const steps: string[] = []
    await environment.ensure(
      { ...target, spec: { cpus: 6, memoryMiB: 8192, diskGiB: 30 } },
      { progress: (phase) => steps.push(phase) },
    )
    expect(h.incus.log).toEqual([
      `stop ${vm}`,
      `update ${vm} ${JSON.stringify({
        config: { "limits.cpu": "6", "limits.memory": "8192MiB" },
        devices: { root: ROOT("30GiB") },
      })}`,
      `start ${vm}`,
    ])
    expect(steps).toEqual(["queued", "booting", "connecting"])
  })

  it("writes what a VM of an earlier version already runs with into its own config, without a restart", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    earlier(h)
    h.incus.log.length = 0
    const kept = { cpus: 2, memoryMiB: 4096, diskGiB: 10 }
    await environment.ensure({ ...target, spec: kept })
    expect(h.incus.log).toEqual([
      `update ${vm} ${JSON.stringify({ config: { "limits.cpu": "2" }, devices: { root: ROOT("10GiB") } })}`,
    ])
    h.incus.log.length = 0
    await environment.ensure({ ...target, spec: kept })
    expect(h.incus.log).toEqual([])
  })

  it("rewrites a size written another way without a restart", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    const instance = h.incus.instances.get(vm) as FakeInstance
    instance.config["limits.memory"] = "6GiB"
    h.incus.log.length = 0
    await environment.ensure(target)
    expect(h.incus.log).toEqual([
      `update ${vm} ${JSON.stringify({ config: { "limits.memory": "6144MiB" } })}`,
    ])
  })

  it("refuses a disk smaller than the VM's, changing nothing", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    h.incus.log.length = 0
    await expect(environment.ensure({ ...target, spec: { ...SPEC, diskGiB: 15 } })).rejects.toThrow(
      "cannot shrink to 15GiB",
    )
    expect(h.incus.log).toEqual([])
  })

  it("stops a frozen VM to change it, and changes a stopped one before it starts", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    setStatus(h, "Frozen")
    h.incus.log.length = 0
    await environment.ensure({ ...target, spec: { ...SPEC, cpus: 2 } })
    expect(h.incus.log.map((line) => line.split(" ")[0])).toEqual(["stop", "update", "start"])
    setStatus(h, "Stopped")
    h.incus.log.length = 0
    await environment.ensure({ ...target, spec: { ...SPEC, cpus: 3 } })
    expect(h.incus.log.map((line) => line.split(" ")[0])).toEqual(["update", "start"])
  })

  it("inspects what a bot's VM runs with, profiles included, and nothing for a bot without one", async () => {
    const { h, environment } = setup()
    await expect(environment.inspect(target.id)).resolves.toBeUndefined()
    await environment.ensure(target)
    earlier(h)
    await expect(environment.inspect(target.id)).resolves.toEqual({
      cpus: 2,
      memoryMiB: 4096,
      diskGiB: 10,
    })
    const instance = h.incus.instances.get(vm) as FakeInstance
    instance.config["limits.cpu"] = "0-3"
    await expect(environment.inspect(target.id)).rejects.toThrow("cannot read the CPU count")
    h.incus.foreign("dsh-bot-feed0001", { "user.dsh-bot.id": "feed0001" })
    await expect(environment.inspect("feed0001")).rejects.toThrow(
      "not created by this installation",
    )
  })

  it("reads its capacity from the Host: its CPUs, three quarters of its memory within what the project's limit leaves, the root disk's pool", async () => {
    const { h, environment } = setup()
    await expect(environment.capacity(target.id)).resolves.toEqual({
      cpus: { min: 1, max: 8, step: 1 },
      memoryMiB: { min: 1024, max: 49152, step: 512 },
      diskGiB: { min: 10, max: 80, step: 1, growOnly: true },
    })
    await environment.ensure(target)
    await environment.ensure({ id: "b0000002", name: "B", spec: { ...SPEC, memoryMiB: 8192 } })
    h.incus.host.project = { "limits.memory": "20GiB" }
    // The bot's own 6 GiB may be given again; the other VM's 8 GiB stays taken.
    await expect(environment.capacity(target.id)).resolves.toMatchObject({
      memoryMiB: { max: 12288 },
    })
    await expect(environment.capacity("b0000002")).resolves.toMatchObject({
      memoryMiB: { max: 14336 },
    })
    h.incus.host.project = {}
    await expect(environment.capacity(target.id)).resolves.toMatchObject({
      memoryMiB: { max: 49152 },
    })
  })

  it("reads its capacity beside an instance given a percentage of the Host's memory in a project without a memory limit", async () => {
    const { h, environment } = setup()
    h.incus.host.project = {}
    h.incus.foreign("other", { "limits.memory": "50%" })
    await expect(environment.capacity(target.id)).resolves.toMatchObject({
      memoryMiB: { max: 49152 },
    })
  })

  it("starts a VM it stopped again when Incus refuses the change, and fails the ensure", async () => {
    const { h, environment } = setup()
    await environment.ensure(target)
    h.incus.log.length = 0
    h.incus.client.update = async () => {
      throw new Error("project limits.memory exceeded")
    }
    await expect(
      environment.ensure({ ...target, spec: { ...SPEC, memoryMiB: 8192 } }),
    ).rejects.toThrow("project limits.memory exceeded")
    expect(h.incus.log).toEqual([`stop ${vm}`, `start ${vm}`])
    expect(h.incus.instances.get(vm)?.status).toBe("Running")
  })
})

describe("reconfigure", () => {
  const base: IncusInstance = {
    name: "vm",
    status: "Running",
    config: { "raw.idmap": IDMAP, "limits.cpu": "4", "limits.memory": "6144MiB" },
    expanded_config: { "raw.idmap": IDMAP, "limits.cpu": "4", "limits.memory": "6144MiB" },
    devices: { workspace: { type: "disk", source: "/s" }, root: ROOT("20GiB") },
    expanded_devices: { workspace: { type: "disk", source: "/s" }, root: ROOT("20GiB") },
  }
  const wants = (spec = SPEC) => ({
    shareConfig: { "raw.idmap": IDMAP },
    shareDevice: { name: "workspace", device: { type: "disk", source: "/s" } },
    spec,
  })

  it("changes nothing for an instance that runs with the spec", () => {
    expect(reconfigure(base, wants())).toEqual({ stop: false, change: undefined, resizes: false })
  })

  it("stops a running instance only when what it runs with changes", () => {
    expect(reconfigure(base, wants({ ...SPEC, memoryMiB: 4096 }))).toMatchObject({
      stop: true,
      resizes: true,
      change: { config: { "limits.memory": "4096MiB" } },
    })
    expect(reconfigure({ ...base, status: "Stopped" }, wants({ ...SPEC, cpus: 2 }))).toMatchObject({
      stop: false,
      resizes: true,
    })
    const spelled = { ...base, config: { ...base.config, "limits.memory": "6GiB" } }
    expect(reconfigure(spelled, wants())).toEqual({
      stop: false,
      resizes: false,
      change: { config: { "limits.memory": "6144MiB" } },
    })
  })

  it("counts Incus's own defaults when neither the config nor the profiles set a value", () => {
    const bare: IncusInstance = {
      ...base,
      config: { "raw.idmap": IDMAP },
      expanded_config: { "raw.idmap": IDMAP },
    }
    expect(reconfigure(bare, wants({ cpus: 1, memoryMiB: 1024, diskGiB: 20 }))).toMatchObject({
      stop: false,
      resizes: false,
    })
  })

  it("refuses to shrink the root disk", () => {
    expect(() => reconfigure(base, wants({ ...SPEC, diskGiB: 19 }))).toThrow("cannot shrink")
  })
})

describe("Incus sizes", () => {
  it("reads sizes with or without a unit, and nothing it cannot read", () => {
    expect(sizeBytesOf("2GiB")).toBe(2 * 1024 ** 3)
    expect(sizeBytesOf("4096MiB")).toBe(4 * 1024 ** 3)
    expect(sizeBytesOf("1GB")).toBe(1000 ** 3)
    expect(sizeBytesOf("512")).toBe(512)
    expect(sizeBytesOf("50%")).toBeUndefined()
    expect(sizeBytesOf(undefined)).toBeUndefined()
  })
})
