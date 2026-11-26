import { useEffect, useState } from "react"
import type { BotModelCatalog } from "../../shared/models"
import { ModelsError, type ModelsFailure } from "./feed"

export type CatalogState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly catalog: BotModelCatalog }
  | { readonly status: "failed"; readonly failure: ModelsFailure }

const failureOf = (error: unknown): ModelsFailure =>
  error instanceof ModelsError
    ? error.failure
    : { kind: "connection", message: error instanceof Error ? error.message : String(error) }

export function useModelCatalog(read: () => Promise<BotModelCatalog>): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: "loading" })
  useEffect(() => {
    let current = true
    read().then(
      (catalog) => {
        if (current) setState({ status: "ready", catalog })
      },
      (error: unknown) => {
        if (current) setState({ status: "failed", failure: failureOf(error) })
      },
    )
    return () => {
      current = false
    }
  }, [read])
  return state
}

export const catalogOf = (state: CatalogState): BotModelCatalog | undefined =>
  state.status === "ready" ? state.catalog : undefined
