import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readReleaseEnv } from "../scripts/release/release-env.mjs"

const root = join(import.meta.dirname, "..")
const script = join(root, "infra/vm/host-setup.sh")
const fake = join(import.meta.dirname, "fixtures/host-setup/fake-host.mjs")
const FAKED = [
  "incus",
  "uname",
  "id",
  "df",
  "ss",
  "sudo",
  "dpkg-query",
  "apt-get",
  "rpm",
  "dnf",
  "curl",
  "gpg",
  "modprobe",
  "systemctl",
  "ufw",
  "firewall-cmd",
  "iptables",
  "nft",
] as const
const REAL = [
  "bash",
  "sh",
  "awk",
  "sed",
  "grep",
  "sort",
  "head",
  "cat",
  "mv",
  "rm",
  "install",
  "mkdir",
  "tr",
  "dirname",
]
const ZABBLY = "4EFC590696CB15B87C73A3AD82CC8797C838DCFD"
const OWNER = "0123456789abcdef0123456789abcdef"
const SERVER_CERTIFICATE = "a1".repeat(32)

type Faked = (typeof FAKED)[number]

interface FakeState {
  arch: string
  uid: number
  freeGiB: number
  sudo: "password" | "nopassword"
  listeners: number[]
  packages: string[]
  units: Record<string, { enabled?: boolean; active?: boolean }>
  modprobe: boolean
  zabblyFingerprint: string
  ufw: { active: boolean; rules: string[] }
  firewalld: { running: boolean; interfaces: string[]; ports: string[] }
  dockerUser: boolean
  nftChains: string
  incus: {
    clientVersion: string
    serverVersion: string
    drivers: string
    certificate: string
    config: Record<string, string>
    tokens: string[]
    issued: string[]
    tokenOutput?: string
    trust: { fingerprint: string; name: string }[]
    storage: Record<string, unknown>
    instances: Record<string, Record<string, Record<string, string>>>
    volumes: Record<string, Record<string, Record<string, Record<string, string>>>>
    acls: Record<string, unknown>
    networks: Record<string, { config: Record<string, string> }>
    projects: Record<string, { config: Record<string, string> }>
  }
  block: string[]
  failOn: string[]
  calls: string[]
}

type Event = { v: 1; type: string } & Record<string, unknown>

interface HostOptions {
  readonly osRelease?: string
  readonly absent?: readonly Faked[]
  readonly kvm?: boolean
  readonly systemd?: boolean
  readonly vsock?: boolean
  readonly state?: (state: FakeState) => void
}

interface Run {
  readonly code: number | null
  readonly events: Event[]
  readonly stderr: string
  readonly stdout: string
}

const DEBIAN_13 =
  'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n'
const DEBIAN_12 =
  'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\n'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const initialState = (): FakeState => ({
  arch: "x86_64",
  uid: 0,
  freeGiB: 100,
  sudo: "password",
  listeners: [],
  packages: [],
  units: {},
  modprobe: true,
  zabblyFingerprint: ZABBLY,
  ufw: { active: false, rules: [] },
  firewalld: { running: false, interfaces: [], ports: [] },
  dockerUser: false,
  nftChains: "",
  incus: {
    clientVersion: "6.0.4",
    serverVersion: "6.0.4",
    drivers: "lxc | qemu",
    certificate: SERVER_CERTIFICATE,
    config: {},
    tokens: [],
    issued: [],
    trust: [],
    storage: {},
    instances: {},
    volumes: {},
    acls: {},
    networks: {},
    projects: {},
  },
  block: [],
  failOn: [],
  calls: [],
})

const which = (command: string) =>
  execFileSync("bash", ["-c", `command -v ${command}`], { encoding: "utf8" }).trim()

const fakeHost = (options: HostOptions = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "host-setup-"))
  dirs.push(dir)
  const sysroot = join(dir, "root")
  const bin = join(dir, "bin")
  for (const path of [
    "etc/modules-load.d",
    "etc/systemd/system",
    "etc/apt/sources.list.d",
    "var/lib",
    "sys/module",
    "dev",
  ])
    mkdirSync(join(sysroot, path), { recursive: true })
  writeFileSync(join(sysroot, "etc/os-release"), options.osRelease ?? DEBIAN_13)
  if (options.kvm ?? true) writeFileSync(join(sysroot, "dev/kvm"), "")
  if (options.systemd ?? true) mkdirSync(join(sysroot, "run/systemd/system"), { recursive: true })
  if (options.vsock ?? false) mkdirSync(join(sysroot, "sys/module/vhost_vsock"))
  mkdirSync(bin)
  for (const command of REAL) symlinkSync(which(command), join(bin, command))
  for (const command of FAKED) {
    if (options.absent?.includes(command)) continue
    writeFileSync(
      join(bin, command),
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fake)} ${command} "$@"\n`,
    )
    chmodSync(join(bin, command), 0o755)
  }
  const statePath = join(dir, "state.json")
  const state = initialState()
  options.state?.(state)
  writeFileSync(statePath, JSON.stringify(state))
  const read = (): FakeState => JSON.parse(readFileSync(statePath, "utf8"))
  const update = (change: (state: FakeState) => void) => {
    const current = read()
    change(current)
    writeFileSync(statePath, JSON.stringify(current))
  }
  const start = (args: readonly string[], env: Record<string, string> = {}) => {
    const child = spawn("bash", [script, ...args], {
      env: { PATH: bin, DSH_BOTS_SYSROOT: sysroot, FAKE_STATE: statePath, FAKE_DIR: dir, ...env },
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    const done = new Promise<Run>((resolve) => {
      child.on("close", (code) => {
        resolve({ code, stdout, stderr, events: args[0] === "--events" ? parseEvents(stdout) : [] })
      })
    })
    return { child, done }
  }
  const run = async (args: readonly string[], env: Record<string, string> = {}) => {
    const { child, done } = start(args, env)
    const result = await done
    child.stdin.end()
    return result
  }
  return { dir, sysroot, read, update, start, run }
}

const parseEvents = (stdout: string): Event[] =>
  stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const event = JSON.parse(line) as Event
      expect(event.v).toBe(1)
      return event
    })

const ofType = (events: readonly Event[], type: string) =>
  events.filter((event) => event.type === type)
const checks = (events: readonly Event[]) =>
  Object.fromEntries(
    ofType(events, "check").map(({ id, v: _v, type: _type, ...rest }) => [id as string, rest]),
  )
const phases = (events: readonly Event[]) =>
  events
    .filter((event) => event.type.startsWith("phase-"))
    .map((event) =>
      event.type === "phase-done"
        ? `${event.phase} done changed=${event.changed}`
        : `${event.phase} ${event.type.slice(6)}`,
    )
const facts = (events: readonly Event[]) =>
  Object.fromEntries(ofType(events, "fact").map((event) => [event.key, event.value]))
const failure = (events: readonly Event[]) => ofType(events, "phase-failed")[0]

const waitFor = async (condition: () => boolean) => {
  const deadline = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const ready = (state: FakeState) => {
  state.packages.push(
    "incus",
    "incus-client",
    "incus-agent",
    "qemu-system-x86",
    "qemu-system-modules-spice",
    "qemu-utils",
    "ovmf",
    "swtpm",
    "dnsmasq-base",
    "btrfs-progs",
    "e2fsprogs",
    "nftables",
    "zstd",
  )
  state.units = {
    "incus.socket": { enabled: true, active: true },
    "incus.service": { enabled: true, active: true },
  }
}

const PROJECT_FEATURES = {
  "features.images": "true",
  "features.profiles": "true",
  "features.storage.volumes": "true",
  "features.networks": "false",
}

const SETUP_ENV = { HTTPS_SCOPE: "loopback", OWNER }

describe("host-setup.sh --events", { timeout: 60_000 }, () => {
  it("starts with hello and ends with end, writing only events to stdout", async () => {
    const host = fakeHost({ state: (s) => Object.assign(s, { uid: 1000 }) })
    const { code, events } = await host.run(["--events", "preflight"])
    expect(code).toBe(0)
    expect(events[0]).toEqual({
      v: 1,
      type: "hello",
      version: readReleaseEnv(root).DSH_BOTS_VERSION,
      uid: 1000,
    })
    expect(events.at(-1)).toEqual({ v: 1, type: "end", ok: true })
    expect(phases(events)).toEqual(["preflight start", "preflight done changed=false"])
  })

  it("preflight: a ready Debian 13 as a user with sudo", async () => {
    const host = fakeHost({ absent: ["incus"], state: (s) => Object.assign(s, { uid: 1000 }) })
    const { events } = await host.run(["--events", "preflight"])
    expect(checks(events)).toEqual({
      arch: { state: "ok", value: "x86_64" },
      os: { state: "ok", value: "Debian GNU/Linux 13 (trixie)" },
      kvm: { state: "ok", value: "/dev/kvm" },
      init: { state: "ok", value: "systemd" },
      disk: { state: "ok", value: "100 GiB free" },
      privilege: { state: "ok", value: "sudo-with-password" },
      incus: { state: "ok", value: "absent" },
      "third-party": { state: "ok", value: "none" },
      port: { state: "ok", value: "8443" },
    })
    expect(host.read().calls.filter((call) => !call.includes("exited"))).not.toContainEqual(
      expect.stringMatching(/^(apt-get|systemctl|incus) /),
    )
  })

  it("preflight: says why a machine cannot be a VM host", async () => {
    const host = fakeHost({
      osRelease: 'PRETTY_NAME="NixOS 25.05"\nID=nixos\nVERSION_ID="25.05"\n',
      kvm: false,
      systemd: false,
      absent: ["sudo", "incus"],
      state: (s) => Object.assign(s, { uid: 1000, arch: "aarch64", freeGiB: 5, listeners: [8443] }),
    })
    const { code, events } = await host.run(["--events", "preflight"])
    expect(code).toBe(0)
    const found = checks(events)
    expect(
      Object.fromEntries(
        Object.entries(found).map(([id, check]) => [id, `${check.state} ${check.code ?? ""}`]),
      ),
    ).toEqual({
      arch: "failed arch-unsupported",
      os: "failed os-dsh-host-only",
      kvm: "failed kvm-missing",
      init: "failed systemd-missing",
      disk: "failed disk-low",
      privilege: "failed sudo-missing",
      incus: "ok ",
      "third-party": "ok ",
      port: "failed port-in-use",
    })
    expect(found.os.what).toContain("NixOS 25.05 is not a tested VM host")
    expect(found.disk).toMatchObject({
      value: "5 GiB free",
      fix: "Free space on that file system.",
    })
  })

  it("preflight: asks for Zabbly on Debian 12 and lets an installed Incus keep its port", async () => {
    const host = fakeHost({
      osRelease: DEBIAN_12,
      state: (s) => Object.assign(s, { uid: 0, listeners: [9443] }),
    })
    const { events } = await host.run(["--events", "preflight"], { HTTPS_PORT: "9443" })
    const found = checks(events)
    expect(found["third-party"]).toMatchObject({
      state: "warning",
      value: "zabbly",
      code: "consent-needed",
    })
    expect(found.incus).toMatchObject({ state: "warning", value: "6.0.4", code: "incus-present" })
    expect(found.port).toMatchObject({ state: "warning", value: "9443", code: "port-maybe-incus" })
    expect(found.privilege).toEqual({ state: "ok", value: "root" })
  })

  it("preflight: sudo without a password", async () => {
    const host = fakeHost({ state: (s) => Object.assign(s, { uid: 1000, sudo: "nopassword" }) })
    const { events } = await host.run(["--events", "preflight"])
    expect(checks(events).privilege).toEqual({ state: "ok", value: "sudo-without-password" })
  })

  it("escapes what it writes as JSON strings", async () => {
    const name = 'Odd "OS" \\ with\ttab'
    const host = fakeHost({
      osRelease: `PRETTY_NAME=${name}\nID=odd\n`,
      state: (s) => Object.assign(s, { uid: 1000 }),
    })
    const { events } = await host.run(["--events", "preflight"])
    expect(checks(events).os).toMatchObject({ value: name, code: "os-unsupported" })
  })

  it("stops a root phase run by a user with not-root, before changing anything", async () => {
    const host = fakeHost({ state: (s) => Object.assign(s, { uid: 1000 }) })
    const { code, events } = await host.run(["--events", "preflight", "packages", "incus"])
    expect(code).toBe(1)
    expect(phases(events)).toEqual([
      "preflight start",
      "preflight done changed=false",
      "packages start",
      "packages failed",
    ])
    expect(failure(events)).toMatchObject({
      code: "not-root",
      what: "The packages phase of host-setup.sh must run as root.",
      fix: "Run it with sudo.",
    })
    expect(events.at(-1)).toEqual({ v: 1, type: "end", ok: false })
    expect(host.read().calls.some((call) => call.startsWith("apt-get"))).toBe(false)
  })

  it("sets up a clean Debian 13 for this machine, then finds nothing to change", async () => {
    const host = fakeHost({
      absent: [],
      state: (s) => Object.assign(s, { ufw: { active: true, rules: [] } }),
    })
    const first = await host.run(["--events", "all", "https", "token"], SETUP_ENV)
    expect(first.code).toBe(0)
    expect(phases(first.events)).toEqual([
      "packages start",
      "packages done changed=true",
      "incus start",
      "incus done changed=true",
      "firewall start",
      "firewall done changed=true",
      "https start",
      "https done changed=true",
      "token start",
      "token done changed=true",
    ])
    expect(facts(first.events)).toEqual({
      os: "Debian GNU/Linux 13 (trixie)",
      "incus-version": "6.0.4",
      project: "dsh-bots",
      pool: "dsh",
      network: "dshbr0",
      "egress-acl": "dsh-bot-egress",
      "https-address": "127.0.0.1:8443",
      "server-fingerprint": SERVER_CERTIFICATE,
    })
    const state = host.read()
    expect(state.incus.config["core.https_address"]).toBe("127.0.0.1:8443")
    expect(state.ufw.rules).toEqual([
      "allow in on dshbr0",
      "route allow in on dshbr0",
      "route allow out on dshbr0",
    ])
    expect(state.incus.projects["dsh-bots"].config).toMatchObject({
      restricted: "true",
      "restricted.networks.access": "dshbr0",
      "user.dsh-bots.pool": "dsh",
      "user.dsh-bots.network": "dshbr0",
      "user.dsh-bots.egress-acl": "dsh-bot-egress",
      "features.networks": "false",
    })
    expect(readFileSync(join(host.sysroot, "etc/modules-load.d/dsh-bots.conf"), "utf8")).toContain(
      "vhost_vsock",
    )
    const [token] = ofType(first.events, "token")
    expect(token.token).toBe(state.incus.issued[0])
    expect(JSON.parse(Buffer.from(String(token.token), "base64").toString())).toEqual({
      client_name: "dsh-bots",
      projects: "dsh-bots",
      restricted: true,
    })
    expect(first.stderr).not.toContain(String(token.token))
    expect(ofType(first.events, "phase-done").at(-1)).toMatchObject({ note: "token for dsh-bots" })

    const second = await host.run(["--events", "all", "https"], SETUP_ENV)
    expect(phases(second.events)).toEqual([
      "packages start",
      "packages done changed=false",
      "incus start",
      "incus done changed=false",
      "firewall start",
      "firewall done changed=false",
      "https start",
      "https done changed=false",
    ])
    expect(host.read().calls.filter((call) => call.startsWith("apt-get install"))).toHaveLength(1)
  })

  it("opens an unset HTTPS address to all and its port in ufw for another machine", async () => {
    const host = fakeHost({ state: (s) => Object.assign(s, { ufw: { active: true, rules: [] } }) })
    const { events } = await host.run(["--events", "https"], {
      HTTPS_SCOPE: "all",
      HTTPS_PORT: "9443",
    })
    expect(facts(events)["https-address"]).toBe(":9443")
    expect(host.read().ufw.rules).toEqual(["allow 9443/tcp"])
  })

  it("keeps an HTTPS address that is already set", async () => {
    const host = fakeHost({
      state: (s) => Object.assign(s.incus.config, { "core.https_address": "10.0.0.5:7443" }),
    })
    const { events } = await host.run(["--events", "https"], { HTTPS_SCOPE: "loopback" })
    expect(facts(events)["https-address"]).toBe("10.0.0.5:7443")
    expect(phases(events)).toEqual(["https start", "https done changed=false"])
    expect(host.read().calls).not.toContainEqual(expect.stringMatching(/^incus config set/))
  })

  it("does not take a port another program listens on", async () => {
    const host = fakeHost({ state: (s) => Object.assign(s, { listeners: [8443] }) })
    const { events } = await host.run(["--events", "https"], { HTTPS_SCOPE: "loopback" })
    expect(failure(events)).toMatchObject({ phase: "https", code: "port-in-use" })
  })

  it("removes the certificate it replaces and an unused token of the same name", async () => {
    const old = "b2".repeat(32)
    const host = fakeHost({
      state: (s) => {
        s.incus.trust = [
          { fingerprint: old, name: "dsh-bots" },
          { fingerprint: "c3".repeat(32), name: "someone" },
        ]
        s.incus.tokens = ["dsh-bots", "other"]
        s.incus.projects["dsh-bots"] = { config: {} }
      },
    })
    const { code, events } = await host.run(["--events", "token"], {
      REPLACE_CLIENT: old.slice(0, 12),
    })
    expect(code).toBe(0)
    const state = host.read()
    expect(state.incus.trust.map((c) => c.name)).toEqual(["someone"])
    expect(state.incus.tokens).toEqual(["other", "dsh-bots"])
    expect(ofType(events, "token")).toHaveLength(1)
  })

  it("fails token-missing when Incus prints no token", async () => {
    const host = fakeHost({
      state: (s) => Object.assign(s.incus, { tokenOutput: "Error: something went wrong!" }),
    })
    const { events } = await host.run(["--events", "token"])
    expect(failure(events)).toMatchObject({ phase: "token", code: "token-missing" })
    expect(ofType(events, "token")).toHaveLength(0)
  })

  it("stops with project-in-use when the project holds another installation's VMs or volumes", async () => {
    const setup = (owner: string) => (s: FakeState) => {
      ready(s)
      s.incus.projects["dsh-bots"] = { config: { ...PROJECT_FEATURES } }
      s.incus.storage.dsh = {}
      s.incus.instances["dsh-bots"] = { "bot-a": { "user.dsh-bot.owner": OWNER } }
      s.incus.volumes["dsh-bots"] = {
        dsh: { "ws-b": { type: "custom", "user.dsh-bot.owner": owner } },
      }
    }
    const foreign = fakeHost({ state: setup("f".repeat(32)) })
    const refused = await foreign.run(["--events", "incus"], SETUP_ENV)
    expect(failure(refused.events)).toMatchObject({ phase: "incus", code: "project-in-use" })
    expect(String(failure(refused.events).what)).toContain("volume dsh/ws-b")
    expect(foreign.read().incus.networks).toEqual({})

    const own = fakeHost({ state: setup(OWNER) })
    const accepted = await own.run(["--events", "incus"], SETUP_ENV)
    expect(phases(accepted.events)).toEqual(["incus start", "incus done changed=true"])
  })

  it("stops with project-conflict on a project with other features", async () => {
    const host = fakeHost({
      state: (s) => {
        s.incus.projects["dsh-bots"] = { config: { "features.images": "false" } }
      },
    })
    const { events } = await host.run(["--events", "incus"])
    expect(failure(events)).toMatchObject({ code: "project-conflict" })
  })

  it("needs consent for Zabbly and checks its signing key", async () => {
    const refused = fakeHost({ osRelease: DEBIAN_12 })
    expect(failure((await refused.run(["--events", "packages"])).events)).toMatchObject({
      code: "third-party-refused",
    })

    const mismatch = fakeHost({
      osRelease: DEBIAN_12,
      state: (s) => Object.assign(s, { zabblyFingerprint: "0".repeat(40) }),
    })
    const wrong = await mismatch.run(["--events", "packages"], { DSH_BOTS_THIRD_PARTY: "yes" })
    expect(failure(wrong.events)).toMatchObject({ code: "zabbly-key-mismatch" })
    expect(existsSync(join(mismatch.sysroot, "etc/apt/keyrings/zabbly.asc"))).toBe(false)

    const allowed = fakeHost({ osRelease: DEBIAN_12 })
    const { code } = await allowed.run(["--events", "packages"], { DSH_BOTS_THIRD_PARTY: "yes" })
    expect(code).toBe(0)
    expect(
      readFileSync(
        join(allowed.sysroot, "etc/apt/sources.list.d/zabbly-incus-lts-6.0.sources"),
        "utf8",
      ),
    ).toContain("Suites: bookworm")
  })

  it("reports an old Incus, a missing VM driver and a missing vhost_vsock", async () => {
    const old = fakeHost({
      state: (s) => {
        ready(s)
        s.incus.serverVersion = "6.0.0"
      },
    })
    expect(failure((await old.run(["--events", "packages"])).events)).toMatchObject({
      code: "incus-too-old",
    })
    const noVm = fakeHost({
      state: (s) => {
        ready(s)
        s.incus.drivers = "lxc"
      },
    })
    expect(failure((await noVm.run(["--events", "packages"])).events)).toMatchObject({
      code: "no-vm-driver",
    })
    const noModule = fakeHost({
      state: (s) => {
        ready(s)
        s.modprobe = false
      },
    })
    expect(failure((await noModule.run(["--events", "packages"])).events)).toMatchObject({
      code: "module-missing",
    })
  })

  it("names a firewall that drops forwarded traffic", async () => {
    const host = fakeHost({
      state: (s) => {
        s.nftChains =
          "table inet filter {\n\tchain forward {\n\t\ttype filter hook forward priority filter; policy drop;\n\t}\n}\ntable inet incus {\n\tchain fwd.dshbr0 {\n\t\ttype filter hook forward priority filter; policy drop;\n\t}\n}"
      },
    })
    const { events } = await host.run(["--events", "firewall"])
    expect(failure(events)).toMatchObject({ code: "firewall-drops" })
    expect(String(failure(events).what)).toContain("(inet filter forward)")
  })

  it("lets dshbr0 through Docker's forward filter once", async () => {
    const host = fakeHost({ state: (s) => Object.assign(s, { dockerUser: true }) })
    const first = await host.run(["--events", "firewall"])
    expect(phases(first.events)).toEqual(["firewall start", "firewall done changed=true"])
    expect(
      readFileSync(
        join(host.sysroot, "etc/systemd/system/dsh-bots-docker-forward.service"),
        "utf8",
      ),
    ).toContain("DOCKER-USER -i dshbr0")
    const second = await host.run(["--events", "firewall"])
    expect(phases(second.events)).toEqual(["firewall start", "firewall done changed=false"])
  })

  it("turns any other failing command into command-failed with the command, place and status", async () => {
    const host = fakeHost({
      state: (s) => {
        ready(s)
        s.failOn.push("incus storage create")
      },
    })
    const { code, events } = await host.run(["--events", "incus"])
    expect(code).toBe(1)
    const failed = failure(events)
    expect(failed).toMatchObject({
      phase: "incus",
      code: "command-failed",
      command: 'incus storage create "$POOL" btrfs size="$POOL_SIZE"',
      exit: 1,
    })
    expect(failed.location).toMatch(/^host-setup\.sh:\d+$/)
    expect(events.at(-1)).toEqual({ v: 1, type: "end", ok: false })
  })

  for (const how of ["cancel", "EOF"] as const) {
    it(`stops after the running command on ${how}`, async () => {
      const host = fakeHost({ state: (s) => s.block.push("apt-get install") })
      const { child, done } = host.start(["--events", "packages", "incus"])
      await waitFor(() => existsSync(join(host.dir, "blocked")))
      if (how === "cancel") (child as ChildProcessWithoutNullStreams).stdin.write("other\ncancel\n")
      else child.stdin.end()
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(child.exitCode).toBe(null)
      writeFileSync(join(host.dir, "release"), "")
      const { code, events } = await done
      child.stdin.end()
      expect(code).toBe(1)
      expect(phases(events)).toEqual(["packages start", "packages failed"])
      expect(failure(events)).toMatchObject({ code: "cancelled" })
      const calls = host.read().calls
      expect(calls.at(-1)).toBe("apt-get exited 0")
    })
  }

  it("runs for a person without --events as before, the token on stdout", async () => {
    const host = fakeHost({
      state: (s) => {
        s.incus.projects["dsh-bots"] = { config: {} }
      },
    })
    const { code, stdout, stderr } = await host.run(["https", "token"], { HTTPS_SCOPE: "all" })
    expect(code).toBe(0)
    const token = host.read().incus.issued[0]
    expect(stdout).toContain(token)
    expect(stdout).toContain("listening on :8443")
    expect(stdout).not.toContain('"type"')
    expect(stderr).toBe("")
  })

  it("refuses unknown phases and settings without events", async () => {
    const host = fakeHost()
    for (const [args, env] of [
      [["--events"], {}],
      [["--events", "local"], {}],
      [["--events", "https"], { HTTPS_SCOPE: "public" }],
      [["--events", "https"], { HTTPS_PORT: "70000" }],
      [["--events", "token"], { REPLACE_CLIENT: "not-hex" }],
      [["--events", "incus"], { OWNER: "Bad Owner" }],
    ] as const) {
      const { code, stdout } = await host.run(args, env)
      expect(code).toBe(2)
      expect(stdout).toBe("")
    }
  })
})
