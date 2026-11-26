import type {
  HostSiteView,
  SetupFailure,
  SetupFailureCode,
  SetupJobState,
  SetupJobView,
  SetupLogLine,
  SetupStepId,
  SetupStepView,
} from "@1outres/dsh-bot-core"
import type { HostSetupEvent, HostSetupFactKey, HostSetupPhase } from "./events"
import type { SetupTarget } from "./site"

export const SETUP_STEPS: readonly SetupStepId[] = [
  "packages",
  "incus",
  "firewall",
  "connect",
  "image",
]

export const ROOT_PHASES = ["packages", "incus", "firewall", "https", "token"] as const

export type RootPhase = (typeof ROOT_PHASES)[number]

const PHASE_STEP: Readonly<Record<RootPhase, SetupStepId>> = {
  packages: "packages",
  incus: "incus",
  firewall: "firewall",
  https: "connect",
  token: "connect",
}

export type SetupStage = "pair" | "check" | "image"

const STAGE_STEP: Readonly<Record<SetupStage, SetupStepId>> = {
  pair: "connect",
  check: "connect",
  image: "image",
}

export interface HostRun {
  readonly hello: boolean
  readonly phase?: RootPhase
  readonly done: readonly RootPhase[]
  readonly token: boolean
  readonly ended: boolean
}

export type SetupFacts = Readonly<Partial<Record<HostSetupFactKey, string>>>

export interface SetupJob {
  readonly id: string
  readonly attempt: number
  readonly site: HostSiteView
  readonly target: SetupTarget
  readonly state: SetupJobState
  readonly steps: readonly SetupStepView[]
  readonly startedAt: number
  readonly endedAt?: number
  readonly failure?: SetupFailure
  readonly facts: SetupFacts
  readonly host: HostRun
  readonly dismissed: boolean
}

interface Timed {
  readonly at: number
}

interface WithTail extends Timed {
  readonly logTail: readonly string[]
}

export interface PluginFailure {
  readonly code: SetupFailureCode
  readonly what: string
  readonly fix: string
  readonly command?: string
  readonly exitCode?: number
}

export type SetupInput =
  | ({ readonly kind: "host-event"; readonly event: HostSetupEvent } & WithTail)
  | ({
      readonly kind: "host-exit"
      readonly code: number | null
      readonly signal: string | null
    } & WithTail)
  | ({ readonly kind: "stage-start"; readonly stage: SetupStage } & Timed)
  | ({
      readonly kind: "stage-done"
      readonly stage: SetupStage
      readonly outcome: "done" | "skipped"
      readonly note?: string
    } & Timed)
  | ({ readonly kind: "fail"; readonly failure: PluginFailure } & WithTail)
  | ({ readonly kind: "cancel" } & Timed)
  | ({ readonly kind: "cancelled" } & WithTail)
  | ({ readonly kind: "interrupt" } & WithTail)
  | { readonly kind: "dismiss" }

const FRESH_RUN: HostRun = { hello: false, done: [], token: false, ended: false }

const pendingSteps = (): readonly SetupStepView[] =>
  SETUP_STEPS.map((id) => ({ id, state: "pending" }))

export interface NewSetupJob {
  readonly id: string
  readonly at: number
  readonly site: HostSiteView
  readonly target: SetupTarget
}

export function newSetupJob(job: NewSetupJob): SetupJob {
  return {
    id: job.id,
    attempt: 1,
    site: job.site,
    target: job.target,
    state: "running",
    steps: pendingSteps(),
    startedAt: job.at,
    facts: {},
    host: FRESH_RUN,
    dismissed: false,
  }
}

export function retrySetupJob(job: SetupJob, again: NewSetupJob): SetupJob {
  return { ...newSetupJob({ ...again, id: job.id }), attempt: job.attempt + 1 }
}

export const isFinished = (state: SetupJobState) => state !== "running" && state !== "cancelling"

const PROTOCOL_FIX =
  "This is a bug in @1outres/dsh-bot-vm or a changed host-setup.sh; report it with the log."

function stepOfFailure(job: SetupJob): SetupStepId {
  const running = job.steps.find((step) => step.state === "running")
  const pending = job.steps.find((step) => step.state === "pending")
  return (running ?? pending ?? job.steps.at(-1))?.id ?? "packages"
}

function withStep(
  job: SetupJob,
  id: SetupStepId,
  change: (step: SetupStepView) => SetupStepView,
): SetupJob {
  return { ...job, steps: job.steps.map((step) => (step.id === id ? change(step) : step)) }
}

function running(job: SetupJob, id: SetupStepId, at: number): SetupJob {
  return withStep(job, id, (step) =>
    step.state === "running" ? step : { ...step, state: "running", startedAt: at },
  )
}

function finished(
  job: SetupJob,
  id: SetupStepId,
  state: "done" | "skipped",
  at: number,
  note?: string,
): SetupJob {
  return withStep(job, id, (step) => ({
    ...step,
    state,
    endedAt: at,
    ...(note === undefined ? {} : { note }),
  }))
}

function ended(
  job: SetupJob,
  state: "failed" | "cancelled" | "interrupted",
  failure: Omit<SetupFailure, "step" | "logTail">,
  input: WithTail,
): SetupJob {
  const step = stepOfFailure(job)
  const failedStep = withStep(job, step, (view) => ({
    ...view,
    state: "failed",
    ...(view.startedAt === undefined ? {} : { endedAt: input.at }),
  }))
  return {
    ...failedStep,
    state,
    endedAt: input.at,
    failure: { step, ...failure, logTail: input.logTail },
  }
}

const protocol = (job: SetupJob, what: string, input: WithTail) =>
  ended(job, "failed", { code: "protocol", what, fix: PROTOCOL_FIX }, input)

const CANCELLED = {
  code: "cancelled",
  what: "The setup was cancelled.",
  fix: "Run it again to continue where it stopped.",
} as const

function hostEvent(job: SetupJob, event: HostSetupEvent, input: WithTail): SetupJob {
  const { host } = job
  if (!host.hello) {
    if (event.type !== "hello")
      return protocol(job, `host-setup.sh sent ${event.type} before hello.`, input)
    return { ...job, host: { ...host, hello: true } }
  }
  if (host.ended) return protocol(job, `host-setup.sh sent ${event.type} after its end.`, input)
  switch (event.type) {
    case "hello":
      return protocol(job, "host-setup.sh said hello twice.", input)
    case "check":
      return protocol(job, "host-setup.sh sent a preflight check during the setup.", input)
    case "phase-start": {
      const phase = rootPhase(event.phase)
      if (phase === undefined || host.phase !== undefined || host.done.includes(phase)) {
        return protocol(job, `host-setup.sh started the phase ${event.phase} out of order.`, input)
      }
      return { ...running(job, PHASE_STEP[phase], input.at), host: { ...host, phase } }
    }
    case "phase-done": {
      const phase = host.phase
      if (phase === undefined || event.phase !== phase) {
        return protocol(
          job,
          `host-setup.sh finished the phase ${event.phase} it had not started.`,
          input,
        )
      }
      if (phase === "token" && !host.token) {
        return protocol(job, "host-setup.sh finished the token phase without a token.", input)
      }
      const next = { ...job, host: { ...host, phase: undefined, done: [...host.done, phase] } }
      if (phase === "https" || phase === "token") {
        return event.note === undefined || phase === "token"
          ? next
          : withStep(next, "connect", (step) => ({ ...step, note: event.note }))
      }
      return finished(
        next,
        PHASE_STEP[phase],
        event.changed ? "done" : "skipped",
        input.at,
        event.note,
      )
    }
    case "phase-failed": {
      if (host.phase === undefined || event.phase !== host.phase) {
        return protocol(
          job,
          `host-setup.sh failed the phase ${event.phase} it had not started.`,
          input,
        )
      }
      const failure = {
        code: event.code,
        what: event.what,
        fix: event.fix,
        ...(event.command === undefined ? {} : { command: event.command }),
        ...(event.location === undefined ? {} : { location: event.location }),
        ...(event.exit === undefined ? {} : { exitCode: event.exit }),
      }
      return ended(job, event.code === "cancelled" ? "cancelled" : "failed", failure, input)
    }
    case "fact":
      return { ...job, facts: { ...job.facts, [event.key]: event.value } }
    case "token":
      if (host.phase !== "token")
        return protocol(job, "host-setup.sh sent a token outside the token phase.", input)
      return { ...job, host: { ...host, token: true } }
    case "end":
      if (!event.ok)
        return protocol(job, "host-setup.sh ended unsuccessfully without a failed phase.", input)
      if (host.phase !== undefined || ROOT_PHASES.some((phase) => !host.done.includes(phase))) {
        return protocol(job, "host-setup.sh ended before every phase was done.", input)
      }
      return { ...job, host: { ...host, ended: true } }
  }
}

function rootPhase(phase: HostSetupPhase): RootPhase | undefined {
  return (ROOT_PHASES as readonly string[]).includes(phase) ? (phase as RootPhase) : undefined
}

function hostExit(job: SetupJob, input: Extract<SetupInput, { kind: "host-exit" }>): SetupJob {
  const how = input.signal === null ? `exit code ${input.code}` : `signal ${input.signal}`
  if (job.host.ended) {
    return input.code === 0
      ? job
      : protocol(job, `host-setup.sh sent its end but stopped with ${how}.`, input)
  }
  if (job.state === "cancelling") return ended(job, "cancelled", CANCELLED, input)
  return protocol(job, `host-setup.sh stopped with ${how} before its end event.`, input)
}

export function reduceSetupJob(job: SetupJob, input: SetupInput): SetupJob {
  if (input.kind === "dismiss") return isFinished(job.state) ? { ...job, dismissed: true } : job
  if (isFinished(job.state)) return job
  switch (input.kind) {
    case "host-event":
      return hostEvent(job, input.event, input)
    case "host-exit":
      return hostExit(job, input)
    case "stage-start":
      return running(job, STAGE_STEP[input.stage], input.at)
    case "stage-done": {
      const step = STAGE_STEP[input.stage]
      if (input.stage === "pair") {
        return input.note === undefined
          ? job
          : withStep(job, step, (view) => ({ ...view, note: input.note }))
      }
      const next = finished(job, step, input.outcome, input.at, input.note)
      return input.stage === "image" ? { ...next, state: "succeeded", endedAt: input.at } : next
    }
    case "fail":
      return ended(job, "failed", input.failure, input)
    case "cancel":
      return { ...job, state: "cancelling" }
    case "cancelled":
      return ended(job, "cancelled", CANCELLED, input)
    case "interrupt":
      return ended(
        job,
        "interrupted",
        {
          code: "interrupted",
          what: "DSH stopped while the setup ran.",
          fix: "Run it again to continue where it stopped.",
        },
        input,
      )
  }
}

export interface SetupLog {
  readonly tail: readonly SetupLogLine[]
  readonly lines: number
}

export function viewOf(job: SetupJob, log: SetupLog): SetupJobView {
  return {
    id: job.id,
    attempt: job.attempt,
    site: job.site,
    project: job.target.project,
    state: job.state,
    steps: job.steps,
    startedAt: job.startedAt,
    ...(job.endedAt === undefined ? {} : { endedAt: job.endedAt }),
    log,
    ...(job.failure === undefined ? {} : { failure: job.failure }),
  }
}
