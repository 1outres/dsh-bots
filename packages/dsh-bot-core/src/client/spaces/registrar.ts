import type { Observable } from "../observable"
import type { SpaceSlotEntry } from "./model"

export interface SpaceSlotRegistrar {
  main(entry: SpaceSlotEntry): () => void
  panel(entry: SpaceSlotEntry): () => void
}

interface Held {
  readonly signature: string
  readonly dispose: () => void
}

const panelSignature = (entry: SpaceSlotEntry) => JSON.stringify([entry.label, entry.order])

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function attempt(label: string, register: () => () => void): () => void {
  try {
    return register()
  } catch (error) {
    console.error(`bot-core: the ${label} registration was refused: ${messageOf(error)}`, error)
    return () => {}
  }
}

export function reconcileSpaceSlots(
  entries: Observable<readonly SpaceSlotEntry[]>,
  registrar: SpaceSlotRegistrar,
): () => void {
  const mains = new Map<string, () => void>()
  const panels = new Map<string, Held>()

  const sync = () => {
    const wanted = entries.getSnapshot()
    const ids = new Set(wanted.map((entry) => entry.id))
    const pinned = new Set(wanted.filter((entry) => entry.pinned).map((entry) => entry.id))
    for (const [id, held] of panels) {
      if (pinned.has(id)) continue
      panels.delete(id)
      held.dispose()
    }
    for (const [id, dispose] of mains) {
      if (ids.has(id)) continue
      mains.delete(id)
      dispose()
    }
    for (const entry of wanted) {
      if (!mains.has(entry.id)) {
        mains.set(
          entry.id,
          attempt(`Space panel ${entry.id}`, () => registrar.main(entry)),
        )
      }
      if (!entry.pinned) continue
      const signature = panelSignature(entry)
      const held = panels.get(entry.id)
      if (held?.signature === signature) continue
      held?.dispose()
      panels.set(entry.id, {
        signature,
        dispose: attempt(`Space panel list entry ${entry.id}`, () => registrar.panel(entry)),
      })
    }
  }

  const off = entries.subscribe(sync)
  sync()
  return () => {
    off()
    for (const held of panels.values()) held.dispose()
    for (const dispose of mains.values()) dispose()
    panels.clear()
    mains.clear()
  }
}
