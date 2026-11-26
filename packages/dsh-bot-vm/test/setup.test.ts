import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  EnvironmentHostCheck,
  EnvironmentHostPlacement,
  HostSiteView,
} from "@1outres/dsh-bot-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { StoredPlacement } from "../src/host/placement/placement"
import { createVmHostSetup, type SetupHost } from "../src/host/setup/setup"
import type { HostSetupBundle, ShellRun } from "../src/host/setup/shell"
import { createSetupSsh, type SshSite } from "../src/host/setup/ssh"
import { setupSshPaths } from "../src/host/setup/ssh-files"
import { fileSetupJobStore } from "../src/host/setup/store"
import { nodeSetupFiles } from "../src/node/setup-files"
import { hostKeyFingerprint, pinnedHostKey } from "../src/node/ssh-tools"
import { ev, fakeHostShell, newShellRecord, type ShellScript } from "./support/fake-host-shell"

const SERVER = "ab".repeat(32)
const BUNDLE: HostSetupBundle = { sha256: "e".repeat(64), files: [] }
const HOST_KEY = `ssh-ed25519 ${Buffer.from("the host key").toString("base64")}`
const PASSWORD = "correct horse"

const tokenText = Buffer.from(
  JSON.stringify({
    client_name: "dsh-bots@test",
    fingerprint: SERVER,
    addresses: ["127.0.0.1:8443"],
    secret: "s".repeat(64),
    expires_at: "0001-01-01T00:00:00Z",
  }),
).toString("base64")

const preflightLines = (privilege = "sudo-with-password", extra: readonly string[] = []) => [
  ev.hello(),
  ev.start("preflight"),
  ev.check("arch", "ok", "x86_64"),
  ev.check("privilege", "ok", privilege),
  ...extra,
  ev.done("preflight", false),
  ev.end(true),
]

const rootLines = (address = "127.0.0.1:8443") => [
  ev.hello(),
  ev.start("packages"),
  ev.fact("os", "Debian GNU/Linux 13 (trixie)"),
  ev.done("packages", true),
  ev.start("incus"),
  ev.done("incus", true),
  ev.start("firewall"),
  ev.done("firewall", false),
  ev.start("https"),
  ev.fact("https-address", address),
  ev.fact("server-fingerprint", SERVER),
  ev.done("https", true, `listening on ${address}`),
  ev.start("token"),
  ev.token(tokenText),
  ev.done("token", true),
  ev.end(true),
]

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Options {
  readonly root?: (run: ShellRun) => ShellScript
  readonly preflight?: readonly string[]
  readonly placement?: EnvironmentHostPlacement
  readonly check?: EnvironmentHostCheck
  readonly stateDir?: string
  readonly pinned?: readonly SshSite[]
  readonly replaceClient?: string
}

function harness(options: Options = {}) {
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), "setup-"))
  if (options.stateDir === undefined) dirs.push(stateDir)
  const record = newShellRecord()
  const adopted: StoredPlacement[] = []
  const logs: string[] = []
  const timers: (() => void)[] = []
  let ids = 0
  let time = 1_000
  const script = (run: ShellRun): ShellScript =>
    run.argv.includes("preflight")
      ? { stdout: options.preflight ?? preflightLines() }
      : run.argv[0] === "sh"
        ? { stdout: [] }
        : (options.root?.(run) ?? { stdout: rootLines() })
  const shellOf = (site: HostSiteView) => fakeHostShell(site, script, record)
  const paths = setupSshPaths(stateDir)
  const host: SetupHost & { notified: number; removed: number } = {
    notified: 0,
    removed: 0,
    placement: () => options.placement ?? { kind: "none" },
    pinnedSites: async () => options.pinned ?? [],
    replaceableClient: async () => options.replaceClient,
    async adopt(placement) {
      adopted.push(placement)
    },
    settle: async () =>
      options.check ?? {
        state: "ready",
        at: 1,
        declaration: { kind: "incus", pool: "dsh", network: "dshbr0" },
      },
    async identityRemoved() {
      host.removed++
    },
    notify() {
      host.notified++
    },
  }
  const imported: string[] = []
  const setup = createVmHostSetup(
    {
      store: fileSetupJobStore(join(stateDir, "setup", "jobs"), nodeSetupFiles, (message) =>
        logs.push(message),
      ),
      ssh: createSetupSsh({
        paths,
        files: nodeSetupFiles,
        comment: "dsh-bots@test",
        keygen: async (path, comment) => {
          writeFileSync(path, "PRIVATE", { mode: 0o600 })
          writeFileSync(
            `${path}.pub`,
            `ssh-ed25519 ${Buffer.from("my key").toString("base64")} ${comment}\n`,
          )
        },
        keyscan: async () => `# vm:22 SSH-2.0-OpenSSH\nvm ${HOST_KEY}\n`,
        pin: pinnedHostKey,
      }),
      shells: { local: () => shellOf({ kind: "this-machine" }), ssh: shellOf },
      bundle: () => BUNDLE,
      pin: pinnedHostKey,
      owner: "0123456789abcdef0123456789abcdef",
      clientName: "dsh-bots@test",
      newId: () => (++ids).toString(16).padStart(32, "0"),
      now: () => ++time,
      later: (_, run) => {
        timers.push(run)
        return () => {
          const at = timers.indexOf(run)
          if (at >= 0) timers.splice(at, 1)
        }
      },
      reachable: async () => {},
      pair: async (request) => ({
        url: request.url,
        serverCertificateSha256: request.token.fingerprint,
        clientCertificate: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
        clientKey: "PRIVATE KEY",
      }),
      importImage: async () => {
        imported.push("image")
        return "imported"
      },
      log: (message) => logs.push(message),
    },
    host,
  )
  const settled = async () => {
    await vi.waitFor(() => {
      for (const timer of timers.splice(0)) timer()
      expect(["running", "cancelling"]).not.toContain(setup.view()?.state)
    })
    return setup.view()
  }
  const logText = async (jobId: string, waitFor: string) => {
    const file = join(stateDir, "setup", "jobs", jobId, "log.txt")
    await vi.waitFor(() =>
      expect(existsSync(file) && readFileSync(file, "utf8")).toContain(waitFor),
    )
    return readFileSync(file, "utf8")
  }
  return { setup, host, record, adopted, logs, timers, settled, stateDir, paths, logText, imported }
}

const thisMachine = { site: { kind: "this-machine" as const }, httpsPort: 8443 }

describe("building a VM host", () => {
  it("runs the root phases with one sudo, pairs with the token, saves the managed placement and imports the image", async () => {
    const t = harness()
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    expect(inspection).toMatchObject({ verdict: "ready", privilege: "sudo-with-password" })
    expect(t.record.runs[0]).toMatchObject({
      privilege: { kind: "user" },
      env: { HTTPS_PORT: "8443" },
    })
    const started = t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    expect(started).toMatchObject({ state: "running", attempt: 1, project: "dsh-bots" })
    const view = await t.settled()
    expect(view).toMatchObject({
      state: "succeeded",
      steps: [
        { state: "done" },
        { state: "done" },
        { state: "skipped" },
        { state: "done" },
        { state: "done" },
      ],
    })
    const run = t.record.runs[1] as ShellRun
    expect(run.argv).toEqual([
      "bash",
      "/tmp/staged-1/vm/host-setup.sh",
      "--events",
      "packages",
      "incus",
      "firewall",
      "https",
      "token",
    ])
    expect(run.privilege).toEqual({ kind: "root", via: "sudo", password: PASSWORD })
    expect(run.env).toEqual({
      PROJECT: "dsh-bots",
      HTTPS_PORT: "8443",
      HTTPS_SCOPE: "loopback",
      CLIENT_NAME: "dsh-bots@test",
      OWNER: "0123456789abcdef0123456789abcdef",
    })
    expect(t.adopted).toEqual([
      {
        version: 3,
        backend: {
          kind: "incus",
          url: "https://127.0.0.1:8443",
          serverCertificateSha256: SERVER,
          clientCertificate: expect.stringContaining("CERTIFICATE"),
          project: "dsh-bots",
        },
        origin: {
          kind: "managed",
          site: { kind: "this-machine" },
          setup: {
            jobId: started.id,
            completedAt: expect.any(Number),
            bundleSha256: BUNDLE.sha256,
          },
        },
      },
    ])
    expect(t.record.released).toEqual(["/tmp/staged-0", "/tmp/staged-1"])
    const log = await t.logText(started.id, "the base image")
    expect(log).toContain("received the trust token")
    expect(log).not.toContain(tokenText)
    const stored = readFileSync(join(t.stateDir, "setup", "jobs", started.id, "job.json"), "utf8")
    expect(stored).not.toContain(tokenText)
    expect(stored).not.toContain(PASSWORD)
    expect(statSync(join(t.stateDir, "setup", "jobs", started.id, "job.json")).mode & 0o777).toBe(
      0o600,
    )
  })

  it("masks the sudo password and the token in what the Host writes to stderr", async () => {
    const t = harness({
      root: () => ({ stdout: rootLines(), stderr: [`echo ${PASSWORD}`, `leak ${tokenText}`] }),
    })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    const { id } = t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    await t.settled()
    const log = await t.logText(id, "the base image")
    expect(log).toContain("host: echo [redacted]")
    expect(log).not.toContain(PASSWORD)
  })

  it("fails as sudo-rejected when sudo asks again, and stops the process", async () => {
    const t = harness({ root: () => ({ stdout: [], stderr: ["Sorry, try again."], hang: true }) })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: "wrong",
    })
    const view = await t.settled()
    expect(view).toMatchObject({
      state: "failed",
      failure: { code: "sudo-rejected", step: "packages" },
    })
    expect(t.record.aborted).toBeGreaterThan(0)
    expect(t.adopted).toEqual([])
  })

  it("fails as sudo-rejected when host-setup.sh does not say hello in time", async () => {
    const t = harness({ root: () => ({ stdout: [], hang: true }) })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: "x",
    })
    expect(await t.settled()).toMatchObject({ state: "failed", failure: { code: "sudo-rejected" } })
  })

  it("cancels with a control line after hello, and continues the same job on the next start", async () => {
    const lines = rootLines()
    const t = harness({
      root: () =>
        t.record.runs.filter((entry) => !entry.argv.includes("preflight")).length === 1
          ? {
              stdout: lines,
              untilCancel: {
                after: 2,
                resume: [ev.failed("packages", "cancelled"), ev.end(false)],
              },
              exit: { code: 1, signal: null },
            }
          : { stdout: lines },
    })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    const { id } = t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    await vi.waitFor(() => expect(t.setup.view()?.steps[0]?.state).toBe("running"))
    expect(t.setup.cancel(id).state).toBe("cancelling")
    expect(await t.settled()).toMatchObject({ state: "cancelled", failure: { code: "cancelled" } })
    expect(t.record.controls).toEqual(["cancel"])
    expect(t.adopted).toEqual([])
    expect(() =>
      t.setup.start({
        inspectionId: inspection.id,
        project: "dsh-bots",
        httpsPort: 8443,
        consents: [],
        sudoPassword: PASSWORD,
      }),
    ).toThrow(/check the VM host again/)
    const again = await t.setup.inspect(thisMachine)
    const second = t.setup.start({
      inspectionId: again.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    expect(second).toMatchObject({ id, attempt: 2 })
    expect(await t.settled()).toMatchObject({ id, state: "succeeded" })
  })

  it("refuses a second job while one runs, a stale inspection, a changed port and missing consents", async () => {
    const t = harness({
      root: () => ({ stdout: [], hang: true }),
      preflight: preflightLines("root", [
        ev.check("third-party", "warning", "zabbly", { code: "consent-needed" }),
      ]),
    })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    expect(() =>
      t.setup.start({
        inspectionId: inspection.id,
        project: "dsh-bots",
        httpsPort: 9443,
        consents: ["zabbly"],
      }),
    ).toThrow(/port changed/)
    expect(() =>
      t.setup.start({
        inspectionId: inspection.id,
        project: "dsh-bots",
        httpsPort: 8443,
        consents: [],
      }),
    ).toThrow(/consent/)
    const view = t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: ["zabbly"],
    })
    await vi.waitFor(() =>
      expect(t.record.runs.at(-1)).toMatchObject({
        privilege: { kind: "root", via: "already-root" },
        env: { DSH_BOTS_THIRD_PARTY: "yes" },
      }),
    )
    const next = await t.setup.inspect(thisMachine)
    expect(() =>
      t.setup.start({
        inspectionId: next.id,
        project: "dsh-bots",
        httpsPort: 8443,
        consents: ["zabbly"],
      }),
    ).toThrow(expect.objectContaining({ code: "setup-busy" }))
    t.setup.cancel(view.id)
    await t.settled()
  })

  it("keeps the placement unchanged when a root phase fails, and fails closed on a broken event", async () => {
    const t = harness({
      root: () => ({
        stdout: [ev.hello(), ev.start("packages"), "not json"],
        exit: { code: 0, signal: null },
      }),
    })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    expect(await t.settled()).toMatchObject({
      state: "failed",
      failure: { code: "protocol", step: "packages" },
    })
    expect(t.adopted).toEqual([])
  })

  it("fails the connection step when the check of the paired host fails", async () => {
    const t = harness({
      check: {
        state: "failed",
        at: 1,
        problems: [
          {
            scope: "incus",
            code: "pool-unusable",
            message: "the pool is full",
            fix: { kind: "repair" },
          },
        ],
      },
    })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    expect(await t.settled()).toMatchObject({
      state: "failed",
      failure: { code: "check-failed", step: "connect" },
    })
    expect(t.imported).toEqual([])
  })

  it("moves this machine's socket only with its project", async () => {
    const t = harness({
      placement: {
        kind: "migration-required",
        from: { kind: "incus-socket", socket: "/var/lib/incus/unix.socket", project: "bots" },
      },
    })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    expect(() =>
      t.setup.start({
        inspectionId: inspection.id,
        project: "dsh-bots",
        httpsPort: 8443,
        consents: [],
        sudoPassword: PASSWORD,
      }),
    ).toThrow(/keeps its project bots/)
    t.setup.start({
      inspectionId: inspection.id,
      project: "bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    expect(await t.settled()).toMatchObject({ state: "succeeded", project: "bots" })
  })

  it("replaces its own earlier certificate on the same site", async () => {
    const t = harness({ replaceClient: "c".repeat(64) })
    await t.setup.load()
    const inspection = await t.setup.inspect(thisMachine)
    t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    await t.settled()
    expect(t.record.runs[1]?.env.REPLACE_CLIENT).toBe("c".repeat(64))
  })

  it("shows a job DSH stopped during its run as interrupted after a restart, and keeps the last five jobs", async () => {
    const first = harness({
      root: () => ({
        stdout: rootLines(),
        untilCancel: { after: 4, resume: [] },
        exit: { code: null, signal: "SIGHUP" },
      }),
    })
    await first.setup.load()
    const inspection = await first.setup.inspect(thisMachine)
    const { id } = first.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
    })
    await vi.waitFor(() => expect(first.setup.view()?.steps[0]?.state).toBe("done"))
    const record = JSON.parse(
      readFileSync(join(first.stateDir, "setup", "jobs", id, "job.json"), "utf8"),
    )
    expect(record.state).toBe("running")
    const second = harness({ stateDir: first.stateDir })
    await second.setup.load()
    expect(second.setup.view()).toMatchObject({
      id,
      state: "interrupted",
      failure: { code: "interrupted", step: "incus" },
    })
    expect(second.setup.view()?.log.tail.length).toBeGreaterThan(0)
    first.setup.close()
    for (let round = 0; round < 6; round++) {
      const next = await second.setup.inspect({ site: { kind: "this-machine" }, httpsPort: 8443 })
      second.setup.start({
        inspectionId: next.id,
        project: `p${round}`,
        httpsPort: 8443,
        consents: [],
        sudoPassword: PASSWORD,
      })
      await second.settled()
    }
    expect(readdirSync(join(first.stateDir, "setup", "jobs"))).toHaveLength(5)
    const shown = second.setup.view()
    expect(shown?.project).toBe("p5")
    second.setup.dismiss(shown?.id as string)
    expect(second.setup.view()?.project).toBe("p4")
  })
})

describe("building another machine over SSH", () => {
  it("creates the key once, pins the scanned key the person trusted and runs everything over that site", async () => {
    const t = harness({ root: () => ({ stdout: rootLines(":8443") }) })
    await t.setup.load()
    const identity = await t.setup.identity()
    expect(identity.authorizedKeysLine).toMatch(/^restrict ssh-ed25519 \S+ dsh-bots@test$/)
    expect(await t.setup.identity()).toEqual(identity)
    const target = { host: "vm.example", port: 2222, user: "admin" }
    const scan = await t.setup.scanHostKey(target)
    expect(scan.keys).toEqual([{ type: "ssh-ed25519", fingerprint: hostKeyFingerprint(HOST_KEY) }])
    const site = {
      kind: "ssh" as const,
      target,
      hostKey: scan.keys[0] as { type: string; fingerprint: string },
    }
    await expect(
      t.setup.inspect({
        site: { ...site, hostKey: { type: "ssh-ed25519", fingerprint: "SHA256:other" } },
        httpsPort: 8443,
      }),
    ).rejects.toThrow(/scan the host key again/)
    const inspection = await t.setup.inspect({ site, httpsPort: 8443 })
    expect(inspection.site).toEqual({
      kind: "ssh",
      ...target,
      hostKey: scan.keys[0],
      identity: "kept",
    })
    expect(readFileSync(t.paths.knownHosts, "utf8")).toBe(`dsh-bots-vm-host ${HOST_KEY}\n`)
    const config = readFileSync(t.paths.config, "utf8")
    expect(config).toContain("HostName vm.example")
    expect(config).toContain("Port 2222")
    expect(config).toContain("StrictHostKeyChecking yes")
    expect(config).toContain("HostKeyAlgorithms ssh-ed25519")
    t.setup.start({
      inspectionId: inspection.id,
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      sudoPassword: PASSWORD,
      identityAfter: "remove",
    })
    expect(await t.settled()).toMatchObject({ state: "succeeded" })
    expect(t.record.runs[1]?.env.HTTPS_SCOPE).toBe("all")
    expect(t.adopted[0]).toMatchObject({
      backend: { url: "https://vm.example:8443" },
      origin: {
        site: {
          kind: "ssh",
          host: "vm.example",
          port: 2222,
          user: "admin",
          hostKey: HOST_KEY,
          identity: "kept",
        },
      },
    })
    expect(t.record.runs.at(-1)?.argv.slice(0, 2)).toEqual(["sh", "-c"])
    expect(t.host.removed).toBe(1)
    expect(existsSync(t.paths.identity)).toBe(false)
  })

  it("starts a repair from the pinned key of the placement without scanning again", async () => {
    const pinned: SshSite = {
      kind: "ssh",
      host: "vm.example",
      port: 22,
      user: "admin",
      hostKey: HOST_KEY,
    }
    const t = harness({ pinned: [pinned] })
    await t.setup.load()
    await t.setup.identity()
    const inspection = await t.setup.inspect({
      site: {
        kind: "ssh",
        target: { host: "vm.example", port: 22, user: "admin" },
        hostKey: pinnedHostKey(HOST_KEY),
      },
      httpsPort: 8443,
    })
    expect(inspection.verdict).toBe("ready")
  })

  it("asks for the authorized_keys line before it has one", async () => {
    const t = harness()
    await t.setup.load()
    await expect(
      t.setup.inspect({
        site: {
          kind: "ssh",
          target: { host: "vm", port: 22, user: "a" },
          hostKey: pinnedHostKey(HOST_KEY),
        },
        httpsPort: 8443,
      }),
    ).rejects.toMatchObject({ code: "identity-missing" })
  })
})
