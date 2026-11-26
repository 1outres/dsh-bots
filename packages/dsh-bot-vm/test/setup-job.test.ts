import { describe, expect, it } from "vitest"
import { parseHostSetupEvent, SetupProtocolError } from "../src/host/setup/events"
import {
  newSetupJob,
  reduceSetupJob,
  retrySetupJob,
  type SetupInput,
  type SetupJob,
} from "../src/host/setup/job"
import { inspectionOf } from "../src/host/setup/preflight"
import { createRedactor } from "../src/host/setup/redact"
import { endpointUrlOf, type SetupTarget } from "../src/host/setup/site"
import { ev } from "./support/fake-host-shell"

const TARGET: SetupTarget = {
  site: { kind: "this-machine" },
  project: "dsh-bots",
  httpsPort: 8443,
  consents: [],
  identityAfter: "keep",
}

const fresh = () =>
  newSetupJob({ id: "a".repeat(32), at: 1, site: { kind: "this-machine" }, target: TARGET })

const event = (line: string, at = 2): SetupInput => ({
  kind: "host-event",
  at,
  event: parseHostSetupEvent(line),
  logTail: ["tail"],
})

const feed = (job: SetupJob, lines: readonly string[]) =>
  lines.reduce((next, line) => reduceSetupJob(next, event(line)), job)

const ROOT_RUN = [
  ev.hello(),
  ev.start("packages"),
  ev.fact("os", "Debian GNU/Linux 13 (trixie)"),
  ev.done("packages", true, "Incus 6.0.4"),
  ev.start("incus"),
  ev.done("incus", false),
  ev.start("firewall"),
  ev.done("firewall", false),
  ev.start("https"),
  ev.fact("https-address", "127.0.0.1:8443"),
  ev.fact("server-fingerprint", "ab".repeat(32)),
  ev.done("https", true, "listening on 127.0.0.1:8443"),
  ev.start("token"),
  ev.token("dG9rZW4="),
  ev.done("token", true),
  ev.end(true),
]

const states = (job: SetupJob) => job.steps.map((step) => `${step.id}:${step.state}`)

describe("host-setup.sh events", () => {
  it("reads every event of the contract", () => {
    expect(parseHostSetupEvent(ev.hello())).toEqual({
      v: 1,
      type: "hello",
      version: "0.4.2",
      uid: 0,
    })
    expect(
      parseHostSetupEvent(
        ev.failed("incus", "command-failed", {
          command: "incus x",
          location: "objects.sh:3",
          exit: 1,
        }),
      ),
    ).toMatchObject({
      code: "command-failed",
      command: "incus x",
      exit: 1,
    })
    expect(
      parseHostSetupEvent(ev.check("third-party", "warning", "zabbly", { code: "consent-needed" })),
    ).toMatchObject({ code: "consent-needed" })
  })

  it.each([
    ["not JSON", "token=abc"],
    ["an unknown type", JSON.stringify({ v: 1, type: "progress" })],
    ["an unknown version", JSON.stringify({ v: 2, type: "hello", version: "x", uid: 0 })],
    ["an unknown failure code", ev.failed("incus", "melted")],
    ["an unknown phase", ev.start("all")],
    ["a check of an unknown id", ev.check("ram", "ok", "8")],
    [
      "a non-boolean changed",
      JSON.stringify({ v: 1, type: "phase-done", phase: "incus", changed: "no" }),
    ],
  ])("refuses %s", (_, line) => {
    expect(() => parseHostSetupEvent(line)).toThrow(SetupProtocolError)
  })

  it("never repeats a line that is not JSON in its error", () => {
    expect(() => parseHostSetupEvent("token secret-value")).toThrow(/^(?!.*secret-value)/)
  })
})

describe("preflight", () => {
  const run = (checks: readonly string[]) =>
    inspectionOf({
      id: "i",
      at: 5,
      site: { kind: "this-machine" },
      events: [
        ev.hello(),
        ev.start("preflight"),
        ...checks,
        ev.done("preflight", false),
        ev.end(true),
      ].map(parseHostSetupEvent),
    })

  it("is ready with the privilege and the consents the checks name", () => {
    expect(
      run([
        ev.check("arch", "ok", "x86_64"),
        ev.check("privilege", "ok", "sudo-with-password"),
        ev.check("incus", "warning", "6.0.4", { code: "incus-present" }),
        ev.check("third-party", "warning", "zabbly", { code: "consent-needed" }),
      ]),
    ).toMatchObject({
      verdict: "ready",
      privilege: "sudo-with-password",
      consents: [{ id: "zabbly" }],
    })
  })

  it("refuses a failed check and points an OS that only runs DSH to another machine", () => {
    expect(
      run([
        ev.check("os", "failed", "NixOS", { code: "os-dsh-host-only", what: "w", fix: "f" }),
        ev.check("privilege", "ok", "root"),
      ]),
    ).toMatchObject({
      verdict: "refused",
      suggestion: "another-machine",
      checks: [{ id: "os", state: "failed", what: "w" }, { id: "privilege" }],
    })
  })

  it("refuses an event stream that does not finish the phase", () => {
    expect(() =>
      inspectionOf({
        id: "i",
        at: 5,
        site: { kind: "this-machine" },
        events: [ev.hello(), ev.start("preflight"), ev.end(true)].map(parseHostSetupEvent),
      }),
    ).toThrow(SetupProtocolError)
  })
})

describe("reduceSetupJob", () => {
  it("maps the phases onto the steps, a phase that changed nothing being already done", () => {
    const job = feed(fresh(), ROOT_RUN)
    expect(states(job)).toEqual([
      "packages:done",
      "incus:skipped",
      "firewall:skipped",
      "connect:running",
      "image:pending",
    ])
    expect(job.steps[0]).toMatchObject({ note: "Incus 6.0.4", startedAt: 2, endedAt: 2 })
    expect(job.steps[3]?.note).toBe("listening on 127.0.0.1:8443")
    expect(job.facts).toMatchObject({
      os: "Debian GNU/Linux 13 (trixie)",
      "https-address": "127.0.0.1:8443",
    })
    expect(JSON.stringify(job)).not.toContain("dG9rZW4=")
    const exited = reduceSetupJob(job, {
      kind: "host-exit",
      at: 3,
      code: 0,
      signal: null,
      logTail: [],
    })
    const checked = [
      { kind: "stage-start", at: 4, stage: "pair" },
      { kind: "stage-done", at: 5, stage: "pair", outcome: "done", note: "https://127.0.0.1:8443" },
      { kind: "stage-start", at: 5, stage: "check" },
      { kind: "stage-done", at: 6, stage: "check", outcome: "done" },
      { kind: "stage-start", at: 6, stage: "image" },
      { kind: "stage-done", at: 9, stage: "image", outcome: "skipped" },
    ].reduce((next, input) => reduceSetupJob(next, input as SetupInput), exited)
    expect(checked.state).toBe("succeeded")
    expect(checked.endedAt).toBe(9)
    expect(states(checked)).toEqual([
      "packages:done",
      "incus:skipped",
      "firewall:skipped",
      "connect:done",
      "image:skipped",
    ])
  })

  it("fails the step of a failed phase with what the Host said", () => {
    const job = feed(fresh(), [
      ev.hello(),
      ev.start("packages"),
      ev.done("packages", false),
      ev.start("incus"),
      ev.failed("incus", "project-in-use", { exit: 1 }),
      ev.end(false),
    ])
    expect(job.state).toBe("failed")
    expect(states(job)).toEqual([
      "packages:skipped",
      "incus:failed",
      "firewall:pending",
      "connect:pending",
      "image:pending",
    ])
    expect(job.failure).toEqual({
      step: "incus",
      code: "project-in-use",
      what: "incus failed",
      fix: "fix it",
      exitCode: 1,
      logTail: ["tail"],
    })
  })

  it("is cancelled when the Host stops on a cancel, and when it exits during a cancel", () => {
    const viaEvent = feed(reduceSetupJob(fresh(), { kind: "cancel", at: 2 }), [
      ev.hello(),
      ev.start("packages"),
      ev.failed("packages", "cancelled"),
      ev.end(false),
    ])
    expect(viaEvent).toMatchObject({
      state: "cancelled",
      failure: { step: "packages", code: "cancelled" },
    })
    const viaExit = reduceSetupJob(
      feed(reduceSetupJob(fresh(), { kind: "cancel", at: 2 }), [ev.hello()]),
      { kind: "host-exit", at: 3, code: 1, signal: null, logTail: [] },
    )
    expect(viaExit).toMatchObject({
      state: "cancelled",
      failure: { code: "cancelled", step: "packages" },
    })
  })

  it.each([
    ["an event before hello", [ev.start("packages")]],
    ["a phase out of order", [ev.hello(), ev.start("packages"), ev.start("incus")]],
    ["a preflight check", [ev.hello(), ev.check("arch", "ok", "x86_64")]],
    [
      "an end before every phase",
      [ev.hello(), ev.start("packages"), ev.done("packages", true), ev.end(true)],
    ],
    ["a token outside its phase", [ev.hello(), ev.token("dG9rZW4=")]],
  ])("fails closed on %s", (_, lines) => {
    expect(feed(fresh(), lines)).toMatchObject({ state: "failed", failure: { code: "protocol" } })
  })

  it("fails closed when the Host stops before its end", () => {
    const job = reduceSetupJob(feed(fresh(), [ev.hello(), ev.start("packages")]), {
      kind: "host-exit",
      at: 3,
      code: 137,
      signal: null,
      logTail: [],
    })
    expect(job).toMatchObject({ state: "failed", failure: { code: "protocol", step: "packages" } })
    expect(job.failure?.what).toContain("exit code 137")
  })

  it("marks a job DSH stopped as interrupted at its running step, and retries it as the next attempt", () => {
    const interrupted = reduceSetupJob(feed(fresh(), [ev.hello(), ev.start("packages")]), {
      kind: "interrupt",
      at: 9,
      logTail: [],
    })
    expect(interrupted).toMatchObject({
      state: "interrupted",
      failure: { step: "packages", code: "interrupted" },
    })
    expect(reduceSetupJob(interrupted, { kind: "cancel", at: 10 })).toBe(interrupted)
    const again = retrySetupJob(interrupted, {
      id: "b".repeat(32),
      at: 20,
      site: { kind: "this-machine" },
      target: TARGET,
    })
    expect(again).toMatchObject({ id: "a".repeat(32), attempt: 2, state: "running", startedAt: 20 })
    expect(again.failure).toBeUndefined()
    expect(states(again)).toEqual(SETUP_PENDING)
  })

  it("dismisses only a finished job", () => {
    expect(reduceSetupJob(fresh(), { kind: "dismiss" }).dismissed).toBe(false)
    const failed = reduceSetupJob(fresh(), {
      kind: "fail",
      at: 2,
      failure: { code: "ssh-failed", what: "w", fix: "f" },
      logTail: [],
    })
    expect(reduceSetupJob(failed, { kind: "dismiss" }).dismissed).toBe(true)
  })
})

const SETUP_PENDING = [
  "packages:pending",
  "incus:pending",
  "firewall:pending",
  "connect:pending",
  "image:pending",
]

describe("where the plugin reaches Incus", () => {
  const ssh = {
    kind: "ssh" as const,
    host: "vm.example",
    port: 22,
    user: "admin",
    hostKey: "ssh-ed25519 AAAA",
  }
  it.each([
    ["127.0.0.1:8443", { kind: "this-machine" as const }, "https://127.0.0.1:8443"],
    [":9443", { kind: "this-machine" as const }, "https://127.0.0.1:9443"],
    ["10.0.0.5:8443", { kind: "this-machine" as const }, "https://10.0.0.5:8443"],
    [":8443", ssh, "https://vm.example:8443"],
    ["[::]:8443", ssh, "https://vm.example:8443"],
    ["10.0.0.5:8443", ssh, "https://10.0.0.5:8443"],
  ])("%s on %o is %s", (address, site, url) => {
    expect(endpointUrlOf(site, address)).toBe(url)
  })
})

describe("redaction", () => {
  it("replaces the sudo password and the token wherever they appear", () => {
    const redactor = createRedactor(["hunter2", undefined])
    redactor.add("dG9rZW4=")
    expect(redactor.apply("pw hunter2 and dG9rZW4= twice hunter2")).toBe(
      "pw [redacted] and [redacted] twice [redacted]",
    )
  })
})
