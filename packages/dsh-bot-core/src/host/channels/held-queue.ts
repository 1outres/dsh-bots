export interface Held<T> {
  readonly reply: T
  readonly awaiting: readonly string[]
  readonly silenced: boolean
}

export type HeldQueue<T> = readonly Held<T>[]

export interface SilencerOutcome {
  readonly callId: string
  readonly silenced: boolean
}

export interface Released<T> {
  readonly queue: HeldQueue<T>
  readonly spoken: readonly T[]
}

export const spokenOf = <T>(queue: HeldQueue<T>): readonly T[] =>
  queue.flatMap((held) => (held.silenced ? [] : [held.reply]))

function released<T>(queue: HeldQueue<T>): Released<T> {
  const waiting = queue.findIndex((held) => held.awaiting.length > 0)
  const ready = waiting === -1 ? queue.length : waiting
  return { queue: queue.slice(ready), spoken: spokenOf(queue.slice(0, ready)) }
}

export const offered = <T>(
  queue: HeldQueue<T>,
  reply: T,
  silencers: readonly string[],
): Released<T> => released([...queue, { reply, awaiting: silencers, silenced: false }])

export const settled = <T>(queue: HeldQueue<T>, outcome: SilencerOutcome): Released<T> =>
  released(
    queue.map((held) =>
      held.awaiting.includes(outcome.callId)
        ? {
            ...held,
            awaiting: held.awaiting.filter((callId) => callId !== outcome.callId),
            silenced: held.silenced || outcome.silenced,
          }
        : held,
    ),
  )
