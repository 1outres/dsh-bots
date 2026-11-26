import type { HostSiteView } from "@1outres/dsh-bot-core"
import type {
  HostSetupBundle,
  HostShell,
  ShellExit,
  ShellProcess,
  ShellRun,
  StagedBundle,
} from "../../src/host/setup/shell"

export interface ShellScript {
  readonly stdout: readonly string[]
  readonly stderr?: readonly string[]
  readonly exit?: ShellExit
  readonly untilCancel?: { readonly after: number; readonly resume: readonly string[] }
  readonly hang?: boolean
}

export interface ShellRecord {
  readonly runs: ShellRun[]
  readonly controls: string[]
  readonly staged: string[]
  readonly released: string[]
  aborted: number
}

export const newShellRecord = (): ShellRecord => ({
  runs: [],
  controls: [],
  staged: [],
  released: [],
  aborted: 0,
})

class Gate {
  private waiting: (() => void)[] = []
  private opened = false
  open() {
    this.opened = true
    for (const wake of this.waiting.splice(0)) wake()
  }
  wait(): Promise<void> {
    if (this.opened) return Promise.resolve()
    return new Promise((resolve) => this.waiting.push(resolve))
  }
}

export function fakeHostShell(
  site: HostSiteView,
  script: (run: ShellRun) => ShellScript,
  record: ShellRecord,
  stageError?: Error,
): HostShell {
  return {
    site,
    async stage(bundle: HostSetupBundle): Promise<StagedBundle> {
      if (stageError !== undefined) throw stageError
      const dir = `/tmp/staged-${record.staged.length}`
      record.staged.push(`${dir} ${bundle.sha256}`)
      return {
        dir,
        release: async () => {
          record.released.push(dir)
        },
      }
    },
    run(request: ShellRun, signal?: AbortSignal): ShellProcess {
      record.runs.push(request)
      const plan = script(request)
      const cancelled = new Gate()
      const stopped = new Gate()
      signal?.addEventListener("abort", () => {
        record.aborted++
        stopped.open()
        cancelled.open()
      })
      let finish: (exit: ShellExit) => void = () => {}
      const exit = new Promise<ShellExit>((resolve) => {
        finish = resolve
      })
      const stdout: AsyncIterable<string> = {
        async *[Symbol.asyncIterator]() {
          const lines = plan.stdout
          const pause = plan.untilCancel?.after ?? lines.length
          for (const line of lines.slice(0, pause)) {
            if (signal?.aborted) break
            yield line
            await Promise.resolve()
          }
          if (plan.hang === true) await stopped.wait()
          if (plan.untilCancel !== undefined && !signal?.aborted) {
            await cancelled.wait()
            if (!signal?.aborted) for (const line of plan.untilCancel.resume) yield line
          }
          finish(
            signal?.aborted === true
              ? { code: null, signal: "SIGTERM" }
              : (plan.exit ?? { code: 0, signal: null }),
          )
        },
      }
      const stderr: AsyncIterable<string> = {
        async *[Symbol.asyncIterator]() {
          for (const line of plan.stderr ?? []) yield line
        },
      }
      return {
        stdout,
        stderr,
        control(line) {
          record.controls.push(line)
          cancelled.open()
        },
        exit,
      }
    },
    async dispose() {},
  }
}

const line = (event: Record<string, unknown>) => JSON.stringify({ v: 1, ...event })

export const ev = {
  hello: () => line({ type: "hello", version: "0.4.2", uid: 0 }),
  start: (phase: string) => line({ type: "phase-start", phase }),
  done: (phase: string, changed: boolean, note?: string) =>
    line({ type: "phase-done", phase, changed, ...(note === undefined ? {} : { note }) }),
  failed: (phase: string, code: string, extra: Record<string, unknown> = {}) =>
    line({ type: "phase-failed", phase, code, what: `${phase} failed`, fix: "fix it", ...extra }),
  fact: (key: string, value: string) => line({ type: "fact", key, value }),
  token: (token: string) => line({ type: "token", token }),
  check: (id: string, state: string, value: string, extra: Record<string, unknown> = {}) =>
    line({ type: "check", id, state, value, ...extra }),
  end: (ok: boolean) => line({ type: "end", ok }),
}
