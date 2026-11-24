import type { MainPreparation } from "../../mains-contract"

/** The registered participants of the preparation stage. */
export interface MainPreparations {
  /** @throws when the id is empty or taken, or the order is not a finite number. */
  register(preparation: MainPreparation): () => void
  /** Lowest order first; equal orders in registration order. */
  list(): readonly MainPreparation[]
}

export function createMainPreparations(): MainPreparations {
  const registered: MainPreparation[] = []
  return {
    register(preparation) {
      if (typeof preparation.id !== "string" || preparation.id === "") {
        throw new Error("a Main preparation needs an id")
      }
      if (!Number.isFinite(preparation.order)) {
        throw new Error(`Main preparation "${preparation.id}" needs a finite order`)
      }
      if (typeof preparation.prepare !== "function") {
        throw new Error(`Main preparation "${preparation.id}" has no prepare function`)
      }
      if (registered.some((other) => other.id === preparation.id)) {
        throw new Error(`a Main preparation "${preparation.id}" is already registered`)
      }
      registered.push(preparation)
      return () => {
        const index = registered.indexOf(preparation)
        if (index >= 0) registered.splice(index, 1)
      }
    },
    list: () =>
      registered
        .map((preparation, index) => ({ preparation, index }))
        .sort(
          (left, right) =>
            left.preparation.order - right.preparation.order || left.index - right.index,
        )
        .map((entry) => entry.preparation),
  }
}
