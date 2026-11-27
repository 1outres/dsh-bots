import type {
  BotEnvironmentImageHost,
  BotEnvironmentImageStatus,
  BotEnvironmentImageView,
  ImageImportStep,
  ImageProblem,
} from "@1outres/dsh-bot-core"
import { ImageStepError, type Importer } from "./importer"
import type { ImageManifest } from "./manifest"
import type { ReleaseChoice } from "./release"

export interface ImageGate {
  ready(signal: AbortSignal | undefined, importing: () => void): Promise<void>
}

export interface ImageManager extends BotEnvironmentImageHost, ImageGate {
  close(): void
}

export interface ImageManagerSettings {
  readonly alias: string
  readonly managed: boolean
  readonly release: ReleaseChoice
}

export interface ImageManagerDeps {
  readonly importer: Importer
  readonly place: () => string | undefined
  readonly now: () => number
  readonly log: (message: string) => void
}

const PROGRESS_STEPS = 200

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createImageManager(
  settings: ImageManagerSettings,
  deps: ImageManagerDeps,
): ImageManager {
  const { importer } = deps
  const { alias, managed } = settings
  const listeners = new Set<(view: BotEnvironmentImageView) => void>()
  const placeField = () => {
    const place = deps.place()
    return place === undefined ? {} : { place }
  }
  let view: BotEnvironmentImageView = {
    alias,
    ...placeField(),
    managed,
    ...(managed && settings.release.ok ? { release: settings.release.release } : {}),
    status: { kind: "unchecked" },
  }
  let running: { readonly controller: AbortController; readonly done: Promise<void> } | undefined

  function publish(
    change: Partial<Pick<BotEnvironmentImageView, "image">>,
    status: BotEnvironmentImageStatus,
  ) {
    const { place: _, ...rest } = view
    view = { ...rest, ...change, ...placeField(), status }
    for (const listener of [...listeners]) listener(view)
  }

  const failed = (step: ImageImportStep | "check", problem: ImageProblem) =>
    publish({}, { kind: "failed", step, problem, at: deps.now() })

  function requirePlace(): string {
    const place = deps.place()
    if (place === undefined) {
      throw new ImageStepError("check", {
        code: "host-unset",
        message: "no VM host is set up",
        fix: "choose the VM host in the dsh-bots settings",
      })
    }
    return place
  }

  function release() {
    if (!settings.release.ok) throw new ImageStepError("check", settings.release.problem)
    return settings.release.release
  }

  function stepErrorOf(error: unknown, step: ImageImportStep | "check", signal?: AbortSignal) {
    if (error instanceof ImageStepError) return error
    if (signal?.aborted) {
      return new ImageStepError(step, {
        code: "cancelled",
        message: "the import was cancelled",
        fix: "start it again; it continues the download",
      })
    }
    return new ImageStepError(step, {
      code: "files",
      message: messageOf(error),
      fix: "check that stateDir is writable and has room",
    })
  }

  async function manifestOf(signal?: AbortSignal): Promise<ImageManifest> {
    const manifest = await importer.manifest(release(), signal)
    if (view.image?.fingerprint !== manifest.image.fingerprint) {
      publish({ image: manifest.image }, view.status)
    }
    return manifest
  }

  async function check(signal?: AbortSignal): Promise<BotEnvironmentImageStatus> {
    requirePlace()
    if (!managed) {
      const target = await importer.target(alias, signal)
      return target === undefined ? { kind: "missing" } : { kind: "ready", fingerprint: target }
    }
    const { fingerprint } = (await manifestOf(signal)).image
    const target = await importer.target(alias, signal)
    if (target === fingerprint) return { kind: "ready", fingerprint }
    return target === undefined ? { kind: "missing" } : { kind: "missing", current: target }
  }

  async function importOnce(signal: AbortSignal): Promise<void> {
    let step: ImageImportStep = "manifest"
    let shown: { step: ImageImportStep; doneBytes: number } = { step, doneBytes: 0 }
    const since = deps.now()
    publish({}, { kind: "importing", progress: { step, doneBytes: 0, totalBytes: 0 }, since })
    try {
      const place = requirePlace()
      const chosen = release()
      const manifest = await manifestOf(signal)
      const { fingerprint } = manifest.image
      if ((await importer.target(alias, signal)) === fingerprint) {
        await importer.clearDownloads()
      } else {
        deps.log(`importing the base image ${chosen.tag} (${fingerprint}) into ${place}`)
        await importer.run(
          chosen,
          manifest,
          alias,
          (at, doneBytes, totalBytes) => {
            step = at
            const due =
              at !== shown.step ||
              doneBytes === totalBytes ||
              doneBytes - shown.doneBytes >= totalBytes / PROGRESS_STEPS ||
              doneBytes < shown.doneBytes
            if (!due) return
            shown = { step: at, doneBytes }
            publish({}, { kind: "importing", progress: { step: at, doneBytes, totalBytes }, since })
          },
          signal,
        )
        deps.log(`the base image ${chosen.tag} is imported as ${alias}`)
      }
      publish({}, { kind: "ready", fingerprint })
    } catch (error) {
      const failure = stepErrorOf(error, step, signal)
      failed(failure.step, failure.problem)
      throw failure
    }
  }

  function begin(): Promise<void> {
    if (running !== undefined) return running.done
    const controller = new AbortController()
    const done = importOnce(controller.signal).finally(() => {
      running = undefined
    })
    done.catch(() => {})
    running = { controller, done }
    return done
  }

  function waitFor(done: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (signal === undefined) return done
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const stop = () => reject(signal.reason)
      signal.addEventListener("abort", stop, { once: true })
      done.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop))
    })
  }

  const notReady = (error: ImageStepError) =>
    new Error(
      `the base image "${alias}" of ${deps.place() ?? "no VM host"} is not ready: ${error.message}`,
    )

  return {
    view: () => view,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async refresh(signal) {
      if (running !== undefined) return view
      publish({}, { kind: "checking" })
      try {
        const status = await check(signal)
        if (running !== undefined) return view
        if (managed && status.kind === "ready") await importer.clearDownloads()
        publish({}, status)
      } catch (error) {
        if (running !== undefined) return view
        const failure = stepErrorOf(error, "check")
        failed(failure.step, failure.problem)
      }
      return view
    },
    start() {
      if (!managed) {
        throw new Error(
          `the base image is not managed (manageImage is off): "${alias}" is used as it is`,
        )
      }
      void begin()
      return view
    },
    cancel() {
      running?.controller.abort(new Error("the import was cancelled"))
      return view
    },
    async ready(signal, importing) {
      if (running === undefined) {
        let status: BotEnvironmentImageStatus
        try {
          status = await check(signal)
        } catch (error) {
          if (signal?.aborted) throw error
          const failure = stepErrorOf(error, "check")
          failed(failure.step, failure.problem)
          throw notReady(failure)
        }
        if (status.kind === "ready") {
          if (view.status.kind !== "ready") publish({}, status)
          return
        }
        if (!managed) {
          const failure = new ImageStepError("check", {
            code: "alias-missing",
            message: `the image alias "${alias}" does not exist`,
            fix: "build the base image (infra/vm/build-base-image.sh) into the project, or turn manageImage on",
          })
          failed(failure.step, failure.problem)
          throw notReady(failure)
        }
      }
      importing()
      try {
        await waitFor(begin(), signal)
      } catch (error) {
        if (error instanceof ImageStepError) throw notReady(error)
        throw error
      }
    },
    close() {
      running?.controller.abort(new Error("the plugin stopped"))
      listeners.clear()
    },
  }
}
