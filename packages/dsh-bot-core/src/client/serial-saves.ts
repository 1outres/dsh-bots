export interface SerialSaves<Edit> {
  save(edit: Edit): Promise<void>
}

export interface SerialSavesOptions<View, Edit> {
  current(): View
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
