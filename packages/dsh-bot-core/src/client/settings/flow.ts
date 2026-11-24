import type { BotsSnapshot } from "../../shared/bots"
import type { Observable, Store } from "../observable"
import { createFrameFlow, type FrameControls, type FrameTarget } from "../settings-frame/flow"
import type { SettingsSection } from "./sections"

export type {
  FrameGuard as SettingsGuard,
  FrameLeave as SettingsLeave,
} from "../settings-frame/flow"

/** The open settings screen: whose bot, at which section and page. */
export interface SettingsTarget extends FrameTarget {
  readonly botId: string
  readonly section: string
}

/** Opening, moving through and closing a bot's settings, asking before typed text is lost. */
export interface SettingsFlow extends Omit<FrameControls, "dismiss"> {
  readonly target: Observable<SettingsTarget | null>
  /**
   * Open the bot's settings at `section` (on a compact window, at the list of
   * sections when omitted) and its `detail` page. On the screen already open
   * for the bot, this moves there.
   * @throws when `section` is not registered, or no section is.
   */
  open(botId: string, section?: string, detail?: string): void
  /** Close the bot's screen at once, if it is open (after the bot is deleted). */
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

/** Close the screen of a bot that is no longer listed (deleted, here or elsewhere). */
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
