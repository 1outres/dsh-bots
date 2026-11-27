import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { constant } from "../src/client/observable"
import type { VmHostClient } from "../src/client/vm-host/client"
import { vmHostBadge } from "../src/client/vm-host/model"
import { setupPageOf } from "../src/client/vm-host/pages"
import {
  addressText,
  changesOf,
  createProjectCommand,
  formOf,
  hostKeyCommand,
  parseAddress,
  parsePort,
  repairIntent,
  retryIntent,
  seedOf,
  startRequestOf,
} from "../src/client/vm-host/setup-model"
import { VmHostSection } from "../src/client/vm-host/VmHostSection"
import type { BotEnvironment } from "../src/contract"
import { createEnvironmentHostPanel } from "../src/host/environment-host/panel"
import type {
  BotEnvironmentHostState,
  EnvironmentHostPlacement,
} from "../src/shared/environment-host"
import type {
  SetupBrief,
  SetupInspection,
  SetupJobView,
  SetupSite,
} from "../src/shared/vm-host-setup"
import { t } from "./support/client"
import { createFakeVmHost, type FakeVmHostOptions } from "./support/fake-vm-host"

function scheduler() {
  const queue: (() => void)[] = []
  let clock = 1000
  return {
    now: () => clock,
    schedule: (ms: number, run: () => void) => {
      queue.push(() => {
        clock += ms
        run()
      })
    },
    drain() {
      while (queue.length > 0) queue.shift()?.()
    },
    step() {
      queue.shift()?.()
    },
  }
}

function fakeHost(options: FakeVmHostOptions = {}) {
  const timers = scheduler()
  const host = createFakeVmHost({ ...options, now: timers.now, schedule: timers.schedule })
  return { host, timers }
}

const THIS_MACHINE: SetupSite = { kind: "this-machine" }
const PINNED = { type: "ssh-ed25519", fingerprint: "SHA256:abc" }
const SSH_SITE: SetupSite = {
  kind: "ssh",
  target: { host: "vm.example", port: 22, user: "admin" },
  hostKey: PINNED,
}

const READY: Extract<SetupInspection, { verdict: "ready" }> = {
  id: "i1",
  at: 0,
  site: { kind: "this-machine" },
  checks: [],
  verdict: "ready",
  privilege: "sudo-with-password",
  consents: [
    {
      kind: "third-party-repository",
      id: "zabbly",
      url: "https://pkgs.zabbly.com",
      signingKey: "k",
    },
  ],
}

describe("VM host setup model", () => {
  it("reads user@host[:port] addresses and prints them back", () => {
    expect(parseAddress("admin@vm.example")).toEqual({
      host: "vm.example",
      port: 22,
      user: "admin",
    })
    expect(parseAddress(" root@10.0.0.5:2222 ")).toEqual({
      host: "10.0.0.5",
      port: 2222,
      user: "root",
    })
    expect(parseAddress("me@[fd00::5]:22")).toEqual({ host: "fd00::5", port: 22, user: "me" })
    for (const bad of ["vm.example", "a@", "a@b:0", "a@b:70000", "a@-oProxy", "a b@c"]) {
      expect(parseAddress(bad)).toBeNull()
    }
    expect(addressText({ host: "fd00::5", port: 2200, user: "me" })).toBe("me@[fd00::5]:2200")
    expect(addressText({ host: "h", port: 22, user: "me" })).toBe("me@h")
    expect(parsePort("8443")).toBe(8443)
    expect(parsePort("0")).toBeNull()
    expect(hostKeyCommand(PINNED)).toBe("ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub")
  })

  it("builds a start request only with a valid project, the needed password and every consent", () => {
    const form = formOf(seedOf({ kind: "new", site: "this-machine" }))
    expect(form).toMatchObject({ project: "dsh-bots", httpsPort: 8443 })
    expect(startRequestOf(form, READY)).toBeNull()
    expect(startRequestOf({ ...form, sudoPassword: "pw" }, READY)).toBeNull()
    const given = { ...form, sudoPassword: " pw ", consents: ["zabbly" as const] }
    expect(startRequestOf(given, READY)).toEqual({
      inspectionId: "i1",
      project: "dsh-bots",
      httpsPort: 8443,
      sudoPassword: " pw ",
      consents: ["zabbly"],
    })
    expect(startRequestOf({ ...given, project: "default" }, READY)).toBeNull()
    const ssh = {
      ...READY,
      privilege: "root" as const,
      consents: [],
      site: {
        kind: "ssh" as const,
        host: "h",
        port: 22,
        user: "root",
        hostKey: PINNED,
        identity: "kept" as const,
      },
    }
    expect(startRequestOf({ ...form, identityAfter: "remove" }, ssh)).toEqual({
      inspectionId: "i1",
      project: "dsh-bots",
      httpsPort: 8443,
      consents: [],
      identityAfter: "remove",
    })
    expect(
      startRequestOf(form, { ...READY, verdict: "refused", checks: [] } as SetupInspection),
    ).toBeNull()
  })

  it("lists the changes by site", () => {
    const form = formOf(seedOf({ kind: "new", site: "ssh" }))
    expect(changesOf("ssh", form, READY.consents).map((line) => line.key)).toEqual([
      "changes.packages",
      "changes.zabbly",
      "changes.incus",
      "changes.firewall",
      "changes.https.all",
      "changes.trust",
      "changes.image",
    ])
    expect(changesOf("this-machine", form, []).map((line) => line.key)).toContain(
      "changes.https.loopback",
    )
  })

  it("repairs a managed host and retries a job on their pinned site, project and port", () => {
    const placed: EnvironmentHostPlacement = {
      kind: "placed",
      backend: {
        kind: "incus",
        url: "https://vm.example:9443",
        project: "bots",
        serverFingerprint: "s",
        clientFingerprint: "c",
      },
      origin: {
        kind: "managed",
        site: {
          kind: "ssh",
          host: "vm.example",
          port: 22,
          user: "admin",
          hostKey: PINNED,
          identity: "kept",
        },
        completedAt: 0,
        update: "available",
      },
    }
    const intent = repairIntent(placed)
    expect(intent).toMatchObject({ kind: "again", project: "bots", httpsPort: 9443 })
    expect(intent === null ? null : seedOf(intent)).toMatchObject({
      fixedSite: SSH_SITE,
      projectFixed: true,
    })
    expect(repairIntent({ ...placed, origin: { kind: "custom" } })).toBeNull()
    const job = { site: { kind: "this-machine" }, project: "p" } as SetupJobView
    expect(seedOf(retryIntent(job, { kind: "none" }))).toMatchObject({
      fixedSite: THIS_MACHINE,
      project: "p",
      httpsPort: 8443,
    })
    expect(seedOf({ kind: "move", project: "old" })).toMatchObject({
      project: "old",
      projectFixed: true,
    })
    expect(setupPageOf("log")).toBe("log")
    expect(setupPageOf("x")).toBeNull()
    expect(createProjectCommand("1.2.3")).toContain(
      "tar.gz/v1.2.3 | tar -xz --strip-components=1 dsh-bots-1.2.3/infra",
    )
  })
})

function panelOf(host: ReturnType<typeof createFakeVmHost>, briefs: SetupBrief[] = []) {
  return createEnvironmentHostPanel({
    environment: {
      current: () => ({ host }) as unknown as BotEnvironment,
      onRegistration: () => () => {},
    },
    pluginVersion: "1.2.3",
    botName: () => undefined,
    onBots: () => () => {},
    async investigate(brief) {
      briefs.push(brief)
      return { sessionId: `session-${briefs.length}` }
    },
  })
}

const jobOf = (state: BotEnvironmentHostState) =>
  state.status === "ready" ? state.host.setup : undefined

describe("VM host setup over the panel", () => {
  it("checks what arrives from the browser before the VM host sees it", async () => {
    const { host } = fakeHost()
    const panel = panelOf(host)
    await expect(panel.scanHostKey({ host: "h", port: 0, user: "u" })).rejects.toThrow(
      "port from 1",
    )
    await expect(panel.inspectSetup({ site: { kind: "lxd" }, httpsPort: 8443 })).rejects.toThrow(
      "site.kind",
    )
    await expect(
      panel.inspectSetup({
        site: { kind: "ssh", target: { host: "h", port: 22, user: "u" } },
        httpsPort: 1,
      }),
    ).rejects.toThrow("hostKey must be an object")
    const inspection = await panel.inspectSetup({ site: THIS_MACHINE, httpsPort: 8443 })
    const start = {
      inspectionId: inspection.id,
      project: "p",
      httpsPort: 8443,
      consents: ["zabbly"],
    }
    await expect(panel.startSetup({ ...start, consents: ["other"] })).rejects.toThrow(
      "consent must be one of",
    )
    await expect(panel.startSetup({ ...start, sudoPassword: "a\nb" })).rejects.toThrow("one line")
    await expect(panel.startSetup({ ...start, identityAfter: "maybe" })).rejects.toThrow(
      "identityAfter",
    )
    await expect(panel.removeSetupIdentity("all")).rejects.toThrow("scope must be one of")
    await expect(panel.cancelSetup(" ")).rejects.toThrow("jobId is empty")
    const state = await panel.startSetup({ ...start, sudoPassword: " pw " })
    expect(jobOf(state)?.state).toBe("running")
    expect(state.status === "ready" && state.pluginVersion).toBe("1.2.3")
  })

  it("follows a fake job to the end, and retries a failed one as the same job", async () => {
    const { host, timers } = fakeHost()
    const panel = panelOf(host)
    const first = await panel.inspectSetup({ site: THIS_MACHINE, httpsPort: 8443 })
    await panel.startSetup({
      inspectionId: first.id,
      project: "p-busy",
      httpsPort: 8443,
      sudoPassword: "pw",
      consents: ["zabbly"],
    })
    await expect(
      panel.startSetup({ inspectionId: first.id, project: "p", httpsPort: 8443, consents: [] }),
    ).rejects.toThrow("setup-busy")
    timers.drain()
    const failed = jobOf(panel.state())
    expect(failed?.state).toBe("failed")
    expect(failed?.failure).toMatchObject({ step: "incus", code: "project-in-use" })
    expect(failed?.steps.map((step) => step.state)).toEqual([
      "done",
      "failed",
      "pending",
      "pending",
      "pending",
    ])
    expect(JSON.stringify(failed)).not.toContain('"pw"')
    expect(
      vmHostBadge({
        status: "ready",
        value: panel.state() as Extract<BotEnvironmentHostState, { status: "ready" }>,
      })?.tone,
    ).toBe("danger")
    const again = await panel.inspectSetup({ site: THIS_MACHINE, httpsPort: 8443 })
    await panel.startSetup({
      inspectionId: again.id,
      project: "p",
      httpsPort: 8443,
      sudoPassword: "pw",
      consents: ["zabbly"],
    })
    timers.drain()
    const done = jobOf(panel.state())
    expect(done).toMatchObject({ id: failed?.id, attempt: 2, state: "succeeded" })
    expect(done?.steps.map((step) => step.state)).toEqual([
      "skipped",
      "skipped",
      "skipped",
      "done",
      "done",
    ])
    const state = panel.state()
    expect(state.status === "ready" && state.host.placement).toMatchObject({
      kind: "placed",
      origin: { kind: "managed", site: { kind: "this-machine" } },
    })
    await panel.dismissSetup(done?.id)
    expect(jobOf(panel.state())).toBeUndefined()
  })

  it("opens a session on a failed job's brief and refuses a job that did not fail", async () => {
    const { host, timers } = fakeHost()
    const briefs: SetupBrief[] = []
    const panel = panelOf(host, briefs)
    const inspection = await panel.inspectSetup({ site: THIS_MACHINE, httpsPort: 8443 })
    const started = jobOf(
      await panel.startSetup({
        inspectionId: inspection.id,
        project: "p-busy",
        httpsPort: 8443,
        sudoPassword: "pw",
        consents: ["zabbly"],
      }),
    )
    timers.drain()
    await expect(panel.investigateSetup(started?.id)).resolves.toEqual({ sessionId: "session-1" })
    expect(briefs[0]).toMatchObject({ cwd: `/state/setup/jobs/${started?.id}` })
    expect(briefs[0]?.message).not.toContain("pw")
    await expect(panel.investigateSetup(42)).rejects.toThrow("jobId must be text")
  })

  it("cancels where the current step ends", async () => {
    const { host, timers } = fakeHost()
    const panel = panelOf(host)
    const inspection = await panel.inspectSetup({ site: THIS_MACHINE, httpsPort: 8443 })
    const started = jobOf(
      await panel.startSetup({
        inspectionId: inspection.id,
        project: "p",
        httpsPort: 8443,
        sudoPassword: "pw",
        consents: ["zabbly"],
      }),
    )
    expect(jobOf(await panel.cancelSetup(started?.id))?.state).toBe("cancelling")
    timers.drain()
    expect(jobOf(panel.state())).toMatchObject({
      state: "cancelled",
      failure: { code: "cancelled", step: "packages" },
    })
  })
})

function render(state: BotEnvironmentHostState, detail: string | null = null) {
  const client = {
    ...constant({ status: "ready" as const, value: state }),
  } as unknown as VmHostClient
  return renderToStaticMarkup(
    createElement(VmHostSection, {
      t,
      host: client,
      openSession() {},
      page: { detail, open() {}, back() {} },
      close() {},
      confirm: async () => false,
    }),
  )
}

const ready = (host: ReturnType<typeof createFakeVmHost>): BotEnvironmentHostState => ({
  status: "ready",
  host: { ...host.view(), egress: [] },
  pluginVersion: "1.2.3",
})

describe("VM host section", () => {
  it("offers the three choices while nothing is chosen, and the pages behind them", () => {
    const { host } = fakeHost()
    const markup = render(ready(host))
    for (const choice of ["this-machine", "another-machine", "existing"]) {
      expect(markup).toContain(`data-dshb-vm-host-choice="${choice}"`)
    }
    expect(render(ready(host), "this-machine")).toContain('data-dshb-build-page="this-machine"')
    expect(render(ready(host), "another-machine")).toContain('data-dshb-ssh=""')
    const existing = render(ready(host), "existing")
    expect(existing).toContain("dsh-bots-1.2.3/infra")
    expect(existing).toContain("vmHost.backend.proxmox")
    expect(existing).toContain('data-dshb-existing-admin="incus"')
  })

  it("shows a failed job with its steps, the fix and the actions", async () => {
    const { host, timers } = fakeHost()
    const inspection = await host.setup.inspect({ site: THIS_MACHINE, httpsPort: 8443 })
    host.setup.start({
      inspectionId: inspection.id,
      project: "p-busy",
      httpsPort: 8443,
      sudoPassword: "pw",
      consents: ["zabbly"],
    })
    timers.step()
    const running = render(ready(host))
    expect(running).toContain('data-dshb-setup-job="running"')
    expect(running).toContain("data-dshb-setup-cancel")
    expect(running).not.toContain("data-dshb-vm-host-choices")
    timers.drain()
    const failed = render(ready(host))
    expect(failed).toContain('data-dshb-setup-failure="project-in-use"')
    expect(failed).toContain("data-dshb-setup-retry")
    expect(failed).toContain("data-dshb-setup-investigate")
    expect(failed).not.toMatch(
      /data-dshb-setup-investigate=""[^>]*disabled|disabled=""[^>]*data-dshb-setup-investigate/,
    )
    expect(render(ready(host), "log")).toContain("data-dshb-setup-log-page")
  })

  it("shows a managed host in use with repair and the SSH key, and a needed move", () => {
    const placed = createFakeVmHost({
      placement: {
        kind: "placed",
        backend: {
          kind: "incus",
          url: "https://vm.example:8443",
          project: "bots",
          serverFingerprint: "s".repeat(64),
          clientFingerprint: "c".repeat(64),
        },
        origin: {
          kind: "managed",
          site: {
            kind: "ssh",
            host: "vm.example",
            port: 22,
            user: "admin",
            hostKey: PINNED,
            identity: "kept",
          },
          completedAt: 0,
          update: "available",
        },
      },
    })
    const markup = render(ready(placed))
    expect(markup).toContain('data-dshb-vm-host-origin="managed"')
    expect(markup).toContain('data-dshb-vm-host-repair-row="available"')
    expect(markup).toContain('data-dshb-vm-host-ssh-key="kept"')
    expect(markup).toContain("admin@vm.example")
    expect(render(ready(placed), "repair")).toContain('data-dshb-ssh="pinned"')
    const moving = createFakeVmHost({
      placement: {
        kind: "migration-required",
        from: { kind: "incus-socket", socket: "/var/lib/incus/unix.socket", project: "dsh-bots" },
      },
    })
    expect(render(ready(moving))).toContain("data-dshb-vm-host-move-start")
    expect(render(ready(moving), "move")).toContain('data-dshb-build-page="this-machine"')
  })
})
