import type { Observable, Store } from "../observable"
import {
  createFrameFlow,
  type FrameControls,
  type FrameGuard,
  type FrameTarget,
} from "../settings-frame/flow"
import type { GlobalSettingsSection } from "./sections"

export type GlobalSettingsTarget = FrameTarget

export interface GlobalSettingsFlow extends FrameControls {
  readonly target: Observable<GlobalSettingsTarget | null>
  readonly guard: Observable<FrameGuard>
  open(section?: string, detail?: string): void
  dispose(): void
}

export function createGlobalSettingsFlow(
  store: Store<GlobalSettingsTarget | null>,
  sections: Observable<readonly GlobalSettingsSection[]>,
): GlobalSettingsFlow {
  const frame = createFrameFlow<GlobalSettingsTarget>({
    store,
    sections,
    noun: "global settings section",
    sameScreen: () => true,
  })
  const follow = () => {
    const target = store.getSnapshot()
    if (target === null) return
    const listed = sections.getSnapshot()
    if (target.section !== null && listed.some((item) => item.id === target.section)) return
    frame.replace({ section: listed[0]?.id ?? null, detail: null, nav: target.nav })
  }
  const off = sections.subscribe(follow)
  const { target, guard, edits, asking } = frame
  return {
    target,
    guard,
    edits,
    asking,
    open: (section, detail) =>
      frame.open({
        section: frame.sectionOf(section),
        detail: detail ?? null,
        nav: section === undefined,
      }),
    select: frame.select,
    openDetail: frame.openDetail,
    back: frame.back,
    showNav: frame.showNav,
    close: frame.close,
    discard: frame.discard,
    keepEditing: frame.keepEditing,
    dismiss: frame.dismiss,
    confirm: frame.confirm,
    answer: frame.answer,
    dispose() {
      off()
      frame.dispose()
    },
  }
}
