import type { EnvironmentHostCheck, SetupLogLine } from "@1outres/dsh-bot-core"
import type { IncusEndpoint } from "../backend/incus/endpoint"
import { parseTrustToken, type TrustToken } from "../backend/incus/trust-token"
import type { StoredPlacement } from "../placement/placement"
import { type HostSetupEvent, parseHostSetupEvent, SetupProtocolError } from "./events"
import {
  isFinished,
  type PluginFailure,
  ROOT_PHASES,
  type SetupInput,
  type SetupJob,
  type SetupStage,
} from "./job"
import type { Redactor } from "./redact"
import {
  HOST_SETUP_ENTRY,
  type HostSetupBundle,
  type HostShell,
  ShellError,
  type ShellPrivilege,
  type ShellProcess,
  type StagedBundle,
} from "./shell"
import { endpointUrlOf, storedSiteOf } from "./site"

export const HELLO_TIMEOUT_MS = 10_000
const FAILURE_TAIL = 40

export interface PairingRequest {
  readonly token: TrustToken
  readonly url: string
  readonly project: string
}

export interface RunnerDeps {
  readonly owner: string
  readonly clientName: string
  readonly now: () => number
  readonly later: (ms: number, run: () => void) => () => void
  reachable(url: string, signal: AbortSignal): Promise<void>
  pair(request: PairingRequest, signal: AbortSignal): Promise<IncusEndpoint>
  adopt(placement: StoredPlacement, clientKey: string): Promise<void>
  settle(): Promise<EnvironmentHostCheck>
  importImage(signal: AbortSignal): Promise<"present" | "imported">
  removeIdentity(): Promise<void>
}

export interface RunnerSink {
  job(): SetupJob
  apply(input: SetupInput): void
  log(source: SetupLogLine["source"], text: string): void
  tail(count: number): readonly string[]
}

export interface RunRequest {
  readonly shell: HostShell
  readonly bundle: HostSetupBundle
  readonly privilege: ShellPrivilege
  readonly replaceClient?: string
  readonly redactor: Redactor
}

export interface RunningJob {
  cancel(): void
  stop(): void
  readonly done: Promise<void>
}

const SUDO_REFUSED =
  /^(Sorry, try again\.?|sudo: .*incorrect password attempts?|sudo: a password is required|sudo: a terminal is required.*|sudo: .* is not in the sudoers file.*|.* is not allowed to run sudo.*)$/

class StageAborted extends Error {}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function hostSetupEnv(job: SetupJob, deps: RunnerDeps, replaceClient: string | undefined) {
  const { target } = job
  return {
    PROJECT: target.project,
    HTTPS_PORT: String(target.httpsPort),
    HTTPS_SCOPE: target.site.kind === "this-machine" ? "loopback" : "all",
    CLIENT_NAME: deps.clientName,
    OWNER: deps.owner,
    ...(target.consents.includes("zabbly") ? { DSH_BOTS_THIRD_PARTY: "yes" } : {}),
    ...(replaceClient === undefined ? {} : { REPLACE_CLIENT: replaceClient }),
  }
}

function describe(event: HostSetupEvent): string | undefined {
  switch (event.type) {
    case "hello":
      return `host-setup.sh ${event.version} runs as uid ${event.uid}`
    case "phase-start":
      return `phase ${event.phase} started`
    case "phase-done":
      return `phase ${event.phase} ${event.changed ? "changed the VM host" : "had nothing to change"}${event.note === undefined ? "" : ` (${event.note})`}`
    case "phase-failed":
      return `phase ${event.phase} failed (${event.code}): ${event.what}`
    case "fact":
      return `${event.key}: ${event.value}`
    case "token":
      return "received the trust token"
    case "end":
      return `host-setup.sh ended ${event.ok ? "successfully" : "unsuccessfully"}`
    case "check":
      return undefined
  }
}

export function runSetupJob(request: RunRequest, deps: RunnerDeps, sink: RunnerSink): RunningJob {
  const { shell, bundle, redactor } = request
  const controller = new AbortController()
  const processController = new AbortController()
  let stopped = false
  let hello = false
  let cancelPending = false
  let process: ShellProcess | undefined
  let token: string | undefined

  const at = () => deps.now()
  const logTail = () => sink.tail(FAILURE_TAIL)
  const live = () => !stopped && !isFinished(sink.job().state)
  const apply = (input: SetupInput) => {
    if (!stopped) sink.apply(input)
  }
  const plugin = (text: string) => {
    if (!stopped) sink.log("plugin", redactor.apply(text))
  }
  const fail = (failure: PluginFailure) => {
    if (!live()) return
    plugin(`failed (${failure.code}): ${failure.what}`)
    apply({ kind: "fail", at: at(), failure, logTail: logTail() })
  }
  const killProcess = () => processController.abort(new Error("host-setup.sh was stopped"))

  async function stage(): Promise<StagedBundle | undefined> {
    plugin(`sending the host setup (sha256 ${bundle.sha256}) to the VM host`)
    try {
      return await shell.stage(bundle, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return undefined
      const code = error instanceof ShellError ? error.code : "staging-failed"
      fail({
        code,
        what: messageOf(error),
        fix:
          code === "host-key-changed"
            ? "Check the VM host's host key again in the dsh-bots settings."
            : "Check that the VM host is reachable over SSH and has room in its temporary directory.",
      })
      return undefined
    }
  }

  function onEvent(event: HostSetupEvent) {
    if (event.type === "token") {
      token = event.token
      redactor.add(event.token)
    }
    const said = describe(event)
    if (said !== undefined) plugin(said)
    apply({ kind: "host-event", at: at(), event, logTail: logTail() })
    if (event.type === "hello") {
      hello = true
      if (cancelPending) process?.control("cancel")
    }
    if (!live()) killProcess()
  }

  async function readStdout(from: AsyncIterable<string>) {
    for await (const line of from) {
      if (!live()) continue
      let event: HostSetupEvent
      try {
        event = parseHostSetupEvent(line)
      } catch (error) {
        if (!(error instanceof SetupProtocolError)) throw error
        fail({
          code: "protocol",
          what: error.message,
          fix: "This is a bug in @1outres/dsh-bot-vm or a changed host-setup.sh; report it with the log.",
        })
        killProcess()
        continue
      }
      onEvent(event)
    }
  }

  async function readStderr(from: AsyncIterable<string>) {
    for await (const raw of from) {
      const line = redactor.apply(raw)
      if (!stopped) sink.log("host", line)
      if (!hello && SUDO_REFUSED.test(raw.trim())) {
        fail({
          code: "sudo-rejected",
          what: `sudo refused: ${line.trim()}`,
          fix: "Enter the sudo password of the VM host's user again; that user must be allowed to use sudo.",
        })
        killProcess()
      }
    }
  }

  async function rootPhases(dir: string): Promise<void> {
    const job = sink.job()
    const proc = shell.run(
      {
        argv: ["bash", `${dir}/${HOST_SETUP_ENTRY}`, "--events", ...ROOT_PHASES],
        env: hostSetupEnv(job, deps, request.replaceClient),
        privilege: request.privilege,
      },
      processController.signal,
    )
    process = proc
    const cancelHelloWait = deps.later(HELLO_TIMEOUT_MS, () => {
      if (hello || !live()) return
      fail({
        code: "sudo-rejected",
        what: `host-setup.sh did not start within ${HELLO_TIMEOUT_MS / 1000} seconds; sudo may be waiting for another password.`,
        fix: "Enter the sudo password of the VM host's user again.",
      })
      killProcess()
    })
    try {
      const [, , exit] = await Promise.all([
        readStdout(proc.stdout),
        readStderr(proc.stderr),
        proc.exit,
      ])
      if (exit.broken !== undefined) {
        fail({
          code: exit.broken.code,
          what: exit.broken.message,
          fix:
            exit.broken.code === "host-key-changed"
              ? "Check the VM host's host key again in the dsh-bots settings."
              : "Check that the VM host is reachable over SSH, then run the setup again.",
        })
      }
      apply({
        kind: "host-exit",
        at: at(),
        code: exit.code,
        signal: exit.signal,
        logTail: logTail(),
      })
    } finally {
      cancelHelloWait()
      process = undefined
    }
  }

  async function pluginStage<T>(
    name: SetupStage,
    work: () => Promise<T>,
    failure: (error: unknown) => PluginFailure,
  ): Promise<T> {
    if (sink.job().state === "cancelling") throw new StageAborted()
    apply({ kind: "stage-start", at: at(), stage: name })
    try {
      return await work()
    } catch (error) {
      if (controller.signal.aborted || error instanceof StageAborted) throw new StageAborted()
      fail(failure(error))
      throw new StageAborted()
    }
  }

  async function connect(): Promise<void> {
    const { facts, target } = sink.job()
    const text = token
    token = undefined
    const address = facts["https-address"]
    const fingerprint = facts["server-fingerprint"]
    if (text === undefined || address === undefined || fingerprint === undefined) {
      fail({
        code: "protocol",
        what: "host-setup.sh ended without the address, the server certificate or the token.",
        fix: "This is a bug in @1outres/dsh-bot-vm or a changed host-setup.sh; report it with the log.",
      })
      throw new StageAborted()
    }
    const url = await pluginStage(
      "pair",
      async () => endpointUrlOf(target.site, address),
      (error) => ({
        code: "pairing-failed",
        what: messageOf(error),
        fix: "Report this with the log.",
      }),
    )
    plugin(`connecting to ${url}`)
    await pluginStage(
      "pair",
      () => deps.reachable(url, controller.signal),
      (error) => ({
        code: "endpoint-unreachable",
        what: `This installation cannot reach Incus at ${url}: ${messageOf(error)}`,
        fix: `Open TCP port ${new URL(url).port} of the VM host to this machine (its firewall, the cloud's security group).`,
      }),
    )
    const endpoint = await pluginStage(
      "pair",
      async () => {
        const trust = parseTrustToken(text)
        if (trust.fingerprint !== fingerprint)
          throw new Error("the trust token names another server certificate than Incus showed")
        return deps.pair({ token: trust, url, project: target.project }, controller.signal)
      },
      (error) => ({
        code: "pairing-failed",
        what: `Pairing with ${url} failed: ${messageOf(error)}`,
        fix: "Run the setup again; it issues a new token.",
      }),
    )
    const job = sink.job()
    const { clientKey, ...stored } = endpoint
    await pluginStage(
      "pair",
      () =>
        deps.adopt(
          {
            version: 3,
            backend: { kind: "incus", ...stored, project: target.project },
            origin: {
              kind: "managed",
              site: storedSiteOf(target.site, "kept"),
              setup: { jobId: job.id, completedAt: deps.now(), bundleSha256: bundle.sha256 },
            },
          },
          clientKey,
        ),
      (error) => ({
        code: "pairing-failed",
        what: `Saving the VM host failed: ${messageOf(error)}`,
        fix: "Check that DSH's credentials service runs and stateDir is writable.",
      }),
    )
    apply({
      kind: "stage-done",
      at: at(),
      stage: "pair",
      outcome: "done",
      note: `${url} (Incus listens on ${address})`,
    })
    plugin(`paired with ${url}; checking the project ${target.project}`)
    const check = await pluginStage(
      "check",
      () => deps.settle(),
      (error) => ({
        code: "check-failed",
        what: messageOf(error),
        fix: "See the Check group of the VM host.",
      }),
    )
    if (check.state !== "ready") {
      const problems =
        check.state === "failed"
          ? check.problems.map((problem) => problem.message).join("; ")
          : `the check is ${check.state}`
      fail({
        code: "check-failed",
        what: `The VM host is paired but its check failed: ${problems}`,
        fix: "See the Check group of the VM host, then repair it.",
      })
      throw new StageAborted()
    }
    apply({
      kind: "stage-done",
      at: at(),
      stage: "check",
      outcome: "done",
      note: `${url} (Incus listens on ${address})`,
    })
  }

  async function image(): Promise<void> {
    const outcome = await pluginStage(
      "image",
      () => deps.importImage(controller.signal),
      (error) => ({
        code: "image-failed",
        what: messageOf(error),
        fix: "See the Base image group; the VM host is usable once the image is imported.",
      }),
    )
    plugin(outcome === "present" ? "the base image is already there" : "imported the base image")
    apply({
      kind: "stage-done",
      at: at(),
      stage: "image",
      outcome: outcome === "present" ? "skipped" : "done",
    })
  }

  async function afterwards(): Promise<void> {
    const { target } = sink.job()
    if (target.site.kind !== "ssh" || target.identityAfter !== "remove") return
    try {
      await deps.removeIdentity()
      plugin("removed this installation's SSH key from the VM host and from here")
    } catch (error) {
      plugin(`removing the SSH key failed; it is kept: ${messageOf(error)}`)
    }
  }

  async function run(): Promise<void> {
    let staged: StagedBundle | undefined
    try {
      plugin(
        `attempt ${sink.job().attempt}: building the VM host for the project ${sink.job().target.project}`,
      )
      staged = await stage()
      if (staged === undefined || !live()) return
      await rootPhases(staged.dir)
      if (!live()) return
      await connect()
      await image()
      await afterwards()
    } catch (error) {
      if (!(error instanceof StageAborted)) {
        fail({
          code: "protocol",
          what: `The setup stopped unexpectedly: ${messageOf(error)}`,
          fix: "Report this with the log.",
        })
      }
    } finally {
      token = undefined
      if (live() && sink.job().state === "cancelling") {
        apply({ kind: "cancelled", at: at(), logTail: logTail() })
      }
      if (staged !== undefined) {
        await staged
          .release()
          .catch((error: unknown) =>
            plugin(`removing the host setup from the VM host failed: ${messageOf(error)}`),
          )
      }
      await shell.dispose().catch(() => {})
    }
  }

  return {
    cancel() {
      if (!live()) return
      apply({ kind: "cancel", at: at() })
      plugin("cancel requested")
      if (process !== undefined) {
        if (hello) process.control("cancel")
        else cancelPending = true
        return
      }
      controller.abort(new Error("the setup was cancelled"))
    },
    stop() {
      stopped = true
      controller.abort(new Error("the plugin stopped"))
      process?.control("cancel")
    },
    done: run(),
  }
}
