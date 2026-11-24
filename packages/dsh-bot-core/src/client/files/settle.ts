import {
  BotFileError,
  type BotFileFailure,
  protocolFailure,
  reportProtocolFailure,
} from "../file-failure"

export type Settled<T> =
  | { readonly status: "done"; readonly value: T }
  | { readonly status: "failed"; readonly failure: BotFileFailure }
  | { readonly status: "aborted" }

const ABORTED: Settled<never> = { status: "aborted" }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A rejection of a `BotFilesClient` call as a failure; anything but a {@link BotFileError} breaks the client's contract. */
export function failureOf(error: unknown): BotFileFailure {
  if (error instanceof BotFileError) return error.failure
  const failure = protocolFailure({ kind: "foreign-rejection" }, messageOf(error), error)
  reportProtocolFailure(failure)
  return failure
}

/** Run one call under `signal`; once the signal is aborted its outcome is `aborted`, whatever the call did. */
export async function settle<T>(
  signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<Settled<T>> {
  try {
    const value = await run(signal)
    return signal.aborted ? ABORTED : { status: "done", value }
  } catch (error) {
    return signal.aborted ? ABORTED : { status: "failed", failure: failureOf(error) }
  }
}
