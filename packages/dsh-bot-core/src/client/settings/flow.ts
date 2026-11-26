import type { BotsSnapshot } from "../../shared/bots"
import type { Observable, Store } from "../observable"
import { createFrameFlow, type FrameControls, type FrameTarget } from "../settings-frame/flow"
import type { SettingsSection } from "./sections"

export type {
  FrameGuard as SettingsGuard,
  FrameLeave as SettingsLeave,
} from "../settings-frame/flow"

export interface SettingsTarget extends FrameTarget {
  readonly botId: string
  readonly section: string
}

export interface SettingsFlow extends Omit<FrameControls, "dismiss"> {
  readonly target: Observable<SettingsTarget | null>
  open(botId: string, section?: string, detail?: string): void
  dismiss(botId: string): void
  dispose(): void
}

export function createSettingsFlow(
  store: Store<SettingsTarget | null>,
  sections: Observable<readonly SettingsSection[]>,
): SettingsFlow {
  const frame = createFrameFlow<SettingsTarget>({
    store,
    sections,
    noun: "settings section",
    sameScreen: (a, b) => a.botId === b.botId,
  })
  const { target, guard, edits, asking } = frame
  return {
    target,
    guard,
    edits,
    asking,
    open(botId, section, detail) {
      const id = frame.sectionOf(section)
      if (id === null) throw new Error("bot-core: no settings section is registered")
      frame.open({ botId, section: id, detail: detail ?? null, nav: section === undefined })
    },
    select: frame.select,
    openDetail: frame.openDetail,
    back: frame.back,
    showNav: frame.showNav,
    close: frame.close,
    discard: frame.discard,
    keepEditing: frame.keepEditing,
    confirm: frame.confirm,
    answer: frame.answer,
    dismiss(botId) {
      if (store.getSnapshot()?.botId === botId) frame.dismiss()
    },
    dispose: frame.dispose,
  }
}

export function dismissWhenGone(
  flow: Pick<SettingsFlow, "target" | "dismiss">,
  snapshot: Observable<BotsSnapshot | undefined>,
): () => void {
  const check = () => {
    const target = flow.target.getSnapshot()
    const listed = snapshot.getSnapshot()
    if (target === null || listed === undefined) return
    if (!listed.bots.some((bot) => bot.id === target.botId)) flow.dismiss(target.botId)
  }
  check()
  const offs = [flow.target.subscribe(check), snapshot.subscribe(check)]
  return () => {
    for (const off of offs) off()
  }
}
