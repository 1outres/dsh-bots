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

export function failureOf(error: unknown): BotFileFailure {
  if (error instanceof BotFileError) return error.failure
  const failure = protocolFailure({ kind: "foreign-rejection" }, messageOf(error), error)
  reportProtocolFailure(failure)
  return failure
}

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
