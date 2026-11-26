import { useCallback, useMemo } from "react"
import type { BotView } from "../../shared/bots"
import { Avatar } from "../Avatar"
import { useObservable } from "../hooks"
import { type BotsState, snapshotOf } from "../session-classification"
import type { FrameControls } from "../settings-frame/flow"
import { SettingsFrame } from "../settings-frame/SettingsFrame"
import { botKey } from "../tree"
import type { Observable, Translate } from "../types"
import type { SettingsScreenId } from "../wiring/screens"
import type { SettingsFlow, SettingsTarget } from "./flow"
import type { SettingsSection, SettingsSections } from "./sections"

export interface SettingsScreenFace {
  readonly bots: Observable<BotsState>
  readonly flow: SettingsFlow
  readonly sections: SettingsSections
  readonly stack: Observable<readonly SettingsScreenId[]>
}

export function SettingsScreen(props: SettingsScreenFace & { readonly t: Translate }) {
  const target = useObservable(props.flow.target)
  const listed = snapshotOf(useObservable(props.bots))?.bots
  const sections = useObservable(props.sections)
  const stack = useObservable(props.stack)
  const bot = target === null ? undefined : listed?.find((item) => item.id === target.botId)
  const section = sections.find((item) => item.id === target?.section)
  if (target === null || bot === undefined || section === undefined) return null
  return (
    <BotScreen
      key={bot.id}
      t={props.t}
      flow={props.flow}
      target={target}
      bot={bot}
      sections={sections}
      section={section}
      covered={stack.at(-1) !== "bot"}
    />
  )
}

interface BotScreenProps {
  readonly t: Translate
  readonly flow: SettingsFlow
  readonly target: SettingsTarget
  readonly bot: BotView
  readonly sections: readonly SettingsSection[]
  readonly section: SettingsSection
  readonly covered: boolean
}

function BotScreen({ t, flow, target, bot, sections, section, covered }: BotScreenProps) {
  const controls = useMemo<FrameControls>(
    () => ({ ...flow, dismiss: () => flow.dismiss(bot.id) }),
    [flow, bot.id],
  )
  const returnFocusTo = useCallback(
    () => [`[data-dshb-key="${CSS.escape(botKey(bot.id))}"]`, "[data-dshb-shell-settings]"],
    [bot.id],
  )
  return (
    <SettingsFrame
      t={t}
      controls={controls}
      target={target}
      heading={{ leading: <Avatar avatar={bot.avatar} size={24} />, title: bot.name }}
      sections={sections}
      view={{ kind: "section", section }}
      subject={bot.id}
      covered={covered}
      renderSection={(item, base) => <item.component {...base} bot={bot} />}
      returnFocusTo={returnFocusTo}
      marks={{ "data-dshb-settings": "", "data-bot-id": bot.id }}
    />
  )
}
