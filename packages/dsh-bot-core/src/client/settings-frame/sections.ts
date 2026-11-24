import type { ComponentType } from "react"
import { createStore, type Observable } from "../observable"
import type { Translate } from "../types"
import type { FrameConfirmation } from "./flow"

/** How a section's status reads: the nav shows only `warning` (amber) and `danger` (red). */
export type SettingsBadgeTone = "success" | "danger" | "warning" | "pending"

/** A section's status beside its name in the nav, with the words a screen reader says for it. */
export interface SettingsBadge {
  readonly tone: SettingsBadgeTone
  label(t: Translate): string
}

/** The page of a section on screen, and the way to a detail page and back. */
export interface FramePage {
  /** The detail page shown (an id the section chose), `null` on the section's first page. */
  readonly detail: string | null
  /** Push a detail page; the frame draws the way back above it. */
  open(detail: string): void
  /** Back to the section's first page. */
  back(): void
}

/**
 * What every settings screen hands the section it shows. Settings are saved
 * as they change; an inline editor with typed text (`TextField`,
 * `SecretRow`, or `usePendingEdit`) makes the screen ask before the text is
 * dropped.
 */
export interface FrameSectionProps {
  readonly t: Translate
  readonly page: FramePage
  /** Close the screen without asking, after an action that ends it. */
  close(): void
  /** Ask the user before a step with consequences; resolves with the answer. */
  confirm(request: FrameConfirmation): Promise<boolean>
}

/**
 * One section of a settings screen, in `order` (ascending, then id). `Props`
 * is what the screen hands its component; `Subject` is what the screen is
 * about (a bot's id; nothing for the global screen), passed to `badge`.
 */
export interface FrameSection<Props extends FrameSectionProps, Subject> {
  readonly id: string
  readonly order: number
  /** The section's name in the nav and on the way back from its detail pages. */
  label(t: Translate): string
  readonly icon: ComponentType<{ size?: number }>
  readonly component: ComponentType<Props>
  /** A status the nav shows while the screen is open; subscribed only meanwhile. */
  badge?(subject: Subject): Observable<SettingsBadge | null>
}

export interface SectionRegistry<Section extends { readonly id: string; readonly order: number }>
  extends Observable<readonly Section[]> {
  /** @returns the disposer; a second section with the same id is refused. */
  register(section: Section): () => void
}

const byOrder = (a: { id: string; order: number }, b: { id: string; order: number }) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The sections of one settings screen; `noun` names them in errors. */
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
