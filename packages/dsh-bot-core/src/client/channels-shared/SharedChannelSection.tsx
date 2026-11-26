import type { BotChannelText } from "../../shared/channels"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { useObservable } from "../hooks"
import { ErrorText, Group, Row } from "../ui"
import { type SharedChannelsFeed, sharedViewOf } from "./model"
import { SharedChannelGroup } from "./SharedChannelGroup"

export interface SharedChannelSectionDeps {
  readonly feed: SharedChannelsFeed
  readonly channelId: string
  text(text: BotChannelText): string
}

export function SharedChannelSection(props: GlobalSettingsSectionProps & SharedChannelSectionDeps) {
  const { t, feed, channelId, text } = props
  const state = useObservable(feed)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("channels.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("channels.unavailable", { message: state.failure.message })}</ErrorText>
  }
  const view = sharedViewOf(state, channelId)
  if (view === undefined) return null
  return (
    <div className="dshb-settings-groups" data-dshb-shared-channels="">
      <SharedChannelGroup
        t={t}
        text={text}
        view={view}
        configure={feed.configure}
        ask={feed.ask(channelId)}
      />
    </div>
  )
}
