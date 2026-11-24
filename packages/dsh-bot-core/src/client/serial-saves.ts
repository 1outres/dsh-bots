/**
 * Saves of one whole-object setting (a channel's, a connector's), one at a
 * time: each edit is applied over the value the save before it stored, so
 * quick changes of two fields do not undo each other.
 */
export interface SerialSaves<Edit> {
  /** Resolves once this edit is saved; rejects with its failure (the next edits still run). */
  save(edit: Edit): Promise<void>
}

export interface SerialSavesOptions<View, Edit> {
  /** The stored value while no save runs. */
  current(): View
  /** Store `edit` over `view`; resolves with what was stored. */
  apply(view: View, edit: Edit): Promise<View>
}

export function createSerialSaves<View, Edit>(
  options: SerialSavesOptions<View, Edit>,
): SerialSaves<Edit> {
  let queue: Promise<View | undefined> = Promise.resolve(undefined)
  let running = 0
  return {
    save(edit) {
      running += 1
      const run = queue.then(async (stored) => {
        const base = stored ?? options.current()
        return options.apply(base, edit)
      })
      queue = run.then(
        (stored) => (running > 1 ? stored : undefined),
        () => undefined,
      )
      const settle = () => {
        running -= 1
      }
      return run.then(
        () => settle(),
        (cause: unknown) => {
          settle()
          throw cause
        },
      )
    },
  }
}
