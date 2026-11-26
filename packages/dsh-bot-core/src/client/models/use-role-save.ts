import { useCallback, useState } from "react"
import type { BotModelChoice, BotModelsChange } from "../../shared/models"
import { ModelsError, type ModelsFailure } from "./feed"

export interface RoleFailure {
  readonly failure: ModelsFailure
  readonly subject?: BotModelChoice
}

export interface RoleSave {
  readonly busy: boolean
  readonly failure: RoleFailure | null
  run(change: BotModelsChange): Promise<boolean>
}

function subjectOf(change: BotModelsChange, failure: ModelsFailure): BotModelChoice | undefined {
  if (failure.kind !== "refused" || failure.place.index === undefined) return undefined
  const role = failure.place.role
  const list = role === undefined ? undefined : change[role]
  return Array.isArray(list) ? list[failure.place.index] : undefined
}

export function useRoleSave(configure: (change: BotModelsChange) => Promise<unknown>): RoleSave {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<RoleFailure | null>(null)
  const run = useCallback(
    async (change: BotModelsChange) => {
      setBusy(true)
      try {
        await configure(change)
        setFailure(null)
        return true
      } catch (cause) {
        const refused: ModelsFailure =
          cause instanceof ModelsError
            ? cause.failure
            : {
                kind: "connection",
                message: cause instanceof Error ? cause.message : String(cause),
              }
        const subject = subjectOf(change, refused)
        setFailure({ failure: refused, ...(subject === undefined ? {} : { subject }) })
        return false
      } finally {
        setBusy(false)
      }
    },
    [configure],
  )
  return { busy, failure, run }
}
