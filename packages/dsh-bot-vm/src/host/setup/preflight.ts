import type {
  ConsentNeed,
  HostSiteView,
  PreflightCheck,
  SetupInspection,
} from "@1outres/dsh-bot-core"
import { type HostSetupEvent, SetupProtocolError } from "./events"

export const ZABBLY_CONSENT: ConsentNeed = {
  kind: "third-party-repository",
  id: "zabbly",
  url: "https://pkgs.zabbly.com",
  signingKey: "4EFC590696CB15B87C73A3AD82CC8797C838DCFD",
}

const PRIVILEGES = ["root", "sudo-without-password", "sudo-with-password"] as const

type Privilege = (typeof PRIVILEGES)[number]

export interface PreflightRun {
  readonly id: string
  readonly at: number
  readonly site: HostSiteView
  readonly events: readonly HostSetupEvent[]
}

const broken = (message: string) =>
  new SetupProtocolError(`host-setup.sh preflight broke its event contract: ${message}`)

function checksOf(events: readonly HostSetupEvent[]) {
  const [hello, start, ...rest] = events
  if (hello?.type !== "hello") throw broken("it did not start with hello")
  if (start?.type !== "phase-start" || start.phase !== "preflight") {
    throw broken("it did not start the preflight phase")
  }
  const end = rest.at(-1)
  const done = rest.at(-2)
  if (end?.type !== "end") throw broken("it did not end")
  const failed = rest.find((event) => event.type === "phase-failed")
  if (failed?.type === "phase-failed") {
    throw new Error(`the preflight failed on the VM host: ${failed.what} (${failed.fix})`)
  }
  if (!end.ok || done?.type !== "phase-done" || done.phase !== "preflight") {
    throw broken("it ended without finishing the preflight phase")
  }
  const checks = rest.slice(0, -2)
  return checks.map((event) => {
    if (event.type !== "check") throw broken(`it sent a ${event.type} event among the checks`)
    return event
  })
}

export function inspectionOf(run: PreflightRun): SetupInspection {
  const events = checksOf(run.events)
  const checks: PreflightCheck[] = events.map((event) => ({
    id: event.id,
    state: event.state,
    value: event.value,
    ...(event.what === undefined ? {} : { what: event.what }),
    ...(event.fix === undefined ? {} : { fix: event.fix }),
  }))
  const base = { id: run.id, at: run.at, site: run.site, checks }
  if (checks.some((check) => check.state === "failed")) {
    const elsewhere =
      run.site.kind === "this-machine" && events.some((event) => event.code === "os-dsh-host-only")
    return { ...base, verdict: "refused", ...(elsewhere ? { suggestion: "another-machine" } : {}) }
  }
  const privilege = events.find((event) => event.id === "privilege")?.value
  if (!(PRIVILEGES as readonly string[]).includes(privilege ?? "")) {
    throw broken(`the privilege check says "${privilege ?? "(missing)"}"`)
  }
  const consents = events.some((event) => event.code === "consent-needed") ? [ZABBLY_CONSENT] : []
  return { ...base, verdict: "ready", privilege: privilege as Privilege, consents }
}
