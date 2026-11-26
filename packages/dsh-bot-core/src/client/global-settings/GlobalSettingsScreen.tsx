import { useObservable } from "../hooks"
import { IconSettings } from "../icons"
import { type FrameView, SettingsFrame } from "../settings-frame/SettingsFrame"
import type { Observable, Translate } from "../types"
import { EmptyState } from "../ui/EmptyState"
import type { SettingsScreenId } from "../wiring/screens"
import type { GlobalSettingsFlow } from "./flow"
import type { GlobalSettingsSectionProps, GlobalSettingsSections } from "./sections"

export interface GlobalSettingsScreenFace {
  readonly flow: GlobalSettingsFlow
  readonly sections: GlobalSettingsSections
  readonly stack: Observable<readonly SettingsScreenId[]>
}

export const GLOBAL_SETTINGS_OPENER = "[data-dshb-global-settings-open]"

const returnFocusTo = () => [GLOBAL_SETTINGS_OPENER]

export function GlobalSettingsScreen(props: GlobalSettingsScreenFace & { readonly t: Translate }) {
  const { t, flow } = props
  const target = useObservable(flow.target)
  const sections = useObservable(props.sections)
  const stack = useObservable(props.stack)
  if (target === null) return null
  const section = sections.find((item) => item.id === target.section)
  const view: FrameView<GlobalSettingsSectionProps, void> =
    section === undefined
      ? {
          kind: "empty",
          message: <EmptyState icon={<IconSettings size={28} />} title={t("global.empty.title")} />,
        }
      : { kind: "section", section }
  return (
    <SettingsFrame
      t={t}
      controls={flow}
      target={target}
      heading={{ leading: null, title: t("global.title") }}
      sections={sections}
      view={view}
      subject={undefined}
      covered={stack.at(-1) !== "global"}
      renderSection={(item, base) => <item.component {...base} />}
      returnFocusTo={returnFocusTo}
      marks={{ "data-dshb-global-settings": "" }}
    />
  )
}
