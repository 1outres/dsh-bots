import type { BotSettingsArea } from "../../settings-contract"
import { settingAreaIdProblem } from "../../shared/settings"

export type SettingsAreaSource = () => readonly BotSettingsArea[]

export const REGISTERED_AREAS_ORDER = 1000

export interface SettingsCatalog {
  register(area: BotSettingsArea): () => void
  include(order: number, source: SettingsAreaSource): () => void
  list(): readonly BotSettingsArea[]
  get(id: string): BotSettingsArea | undefined
}

export function checkSettingsArea(area: BotSettingsArea): void {
  const problem = settingAreaIdProblem(area.id)
  if (problem !== undefined) throw new Error(problem)
  if (area.label.en.trim() === "") throw new Error(`settings area "${area.id}" has no label`)
  if (area.location.en.trim() === "") {
    throw new Error(`settings area "${area.id}" has no location`)
  }
}

interface Included {
  readonly order: number
  readonly source: SettingsAreaSource
}

export function createSettingsCatalog(): SettingsCatalog {
  const sources: Included[] = []
  const add = (included: Included) => {
    sources.push(included)
    sources.sort((left, right) => left.order - right.order)
    return () => {
      const index = sources.indexOf(included)
      if (index !== -1) sources.splice(index, 1)
    }
  }
  const list = (): readonly BotSettingsArea[] => {
    const seen = new Set<string>()
    return sources.flatMap(({ source }) =>
      source().filter((area) => {
        if (seen.has(area.id)) return false
        seen.add(area.id)
        return true
      }),
    )
  }
  return {
    register(area) {
      checkSettingsArea(area)
      if (list().some((known) => known.id === area.id)) {
        throw new Error(`settings area "${area.id}" is already registered`)
      }
      return add({ order: REGISTERED_AREAS_ORDER, source: () => [area] })
    },
    include: (order, source) => add({ order, source }),
    list,
    get: (id) => list().find((area) => area.id === id),
  }
}
