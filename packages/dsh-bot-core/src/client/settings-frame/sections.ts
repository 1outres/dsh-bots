import type { ComponentType } from "react"
import { createStore, type Observable } from "../observable"
import type { Translate } from "../types"
import type { FrameConfirmation } from "./flow"

export type SettingsBadgeTone = "success" | "danger" | "warning" | "pending"

export interface SettingsBadge {
  readonly tone: SettingsBadgeTone
  label(t: Translate): string
}

export interface FramePage {
  readonly detail: string | null
  open(detail: string): void
  back(): void
}

export interface FrameSectionProps {
  readonly t: Translate
  readonly page: FramePage
  close(): void
  confirm(request: FrameConfirmation): Promise<boolean>
}

export interface FrameSection<Props extends FrameSectionProps, Subject> {
  readonly id: string
  readonly order: number
  label(t: Translate): string
  readonly icon: ComponentType<{ size?: number }>
  readonly component: ComponentType<Props>
  badge?(subject: Subject): Observable<SettingsBadge | null>
}

export interface SectionRegistry<Section extends { readonly id: string; readonly order: number }>
  extends Observable<readonly Section[]> {
  register(section: Section): () => void
}

const byOrder = (a: { id: string; order: number }, b: { id: string; order: number }) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function createSectionRegistry<
  Section extends { readonly id: string; readonly order: number },
>(noun: string): SectionRegistry<Section> {
  const sections = createStore<readonly Section[]>([])
  return {
    getSnapshot: sections.getSnapshot,
    subscribe: sections.subscribe,
    register(section) {
      if (sections.getSnapshot().some((item) => item.id === section.id)) {
        throw new Error(`bot-core: ${noun} "${section.id}" is already registered`)
      }
      sections.update((current) => [...current, section].sort(byOrder))
      return () => {
        if (sections.getSnapshot().includes(section)) {
          sections.update((current) => current.filter((item) => item !== section))
        }
      }
    },
  }
}
