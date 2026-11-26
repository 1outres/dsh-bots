import { createElement } from "react"
import type { BotChannelSharedSnapshot } from "../../shared/channels"
import { sharedChannelBadge } from "../channels-shared/badge"
import { type SharedChannelsFeed, sharedViewOf } from "../channels-shared/model"
import { SharedChannelSection } from "../channels-shared/SharedChannelSection"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { IconChannels } from "../icons"
import { derive } from "../observable"
import type { ClientContext } from "../types"
import type { SettingsScreens } from "./screens"

export const SHARED_CHANNEL_ORDER = 150

export const sharedChannelSection = (channelId: string) => `channel-${channelId}`

export function wireSharedChannels(
  ctx: ClientContext,
  feed: SharedChannelsFeed,
  screens: Pick<SettingsScreens, "global">,
): void {
  const text = (value: { readonly en: string; readonly ja?: string }) =>
    ctx.locale.resolveText({ ...value })
  ctx.effect(() => {
    const registered = new Map<string, { readonly name: string; readonly off: () => void }>()
    const follow = () => {
      const state = feed.getSnapshot()
      const snapshot: BotChannelSharedSnapshot | undefined =
        state.status === "ready" ? state.snapshot : undefined
      if (snapshot === undefined) return
      const listed = new Map(snapshot.channels.map((view) => [view.channel.id, view.channel.name]))
      for (const [id, entry] of [...registered]) {
        if (listed.get(id) === entry.name) continue
        entry.off()
        registered.delete(id)
      }
      for (const [id, name] of listed) {
        if (registered.has(id)) continue
        const off = screens.global.sections.register({
          id: sharedChannelSection(id),
          order: SHARED_CHANNEL_ORDER,
          label: () => name,
          icon: IconChannels,
          component: (props: GlobalSettingsSectionProps) =>
            createElement(SharedChannelSection, { ...props, feed, channelId: id, text }),
          badge: () => derive([feed], (current) => sharedChannelBadge(sharedViewOf(current, id))),
        })
        registered.set(id, { name, off })
      }
    }
    const off = feed.subscribe(follow)
    follow()
    return () => {
      off()
      for (const entry of registered.values()) entry.off()
      registered.clear()
      feed.dispose()
    }
  }, "bot-core: shared channel sections")
}
