import type { ComponentType } from "react"
import {
  IconArchive,
  IconArchiveOff,
  IconManaged,
  IconManagedOff,
  IconNewChat,
  IconRefresh,
  IconSettings,
  IconTrash,
  IconUnarchive,
  IconUser,
} from "./icons"
import type { ClientContext } from "./types"

export const MENU_ICON = {
  newSession: "bot-core.new-session",
  newMain: "bot-core.new-main",
  settings: "bot-core.settings",
  delete: "bot-core.delete",
  archive: "bot-core.archive",
  unarchive: "bot-core.unarchive",
  showArchived: "bot-core.show-archived",
  hideArchived: "bot-core.hide-archived",
  entrust: "bot-core.entrust",
  release: "bot-core.release",
  answerOwner: "bot-core.answer-owner",
  answerMain: "bot-core.answer-main",
} as const

const GLYPHS: {
  readonly [Key in (typeof MENU_ICON)[keyof typeof MENU_ICON]]: ComponentType<{ size?: number }>
} = {
  "bot-core.new-session": IconNewChat,
  "bot-core.new-main": IconRefresh,
  "bot-core.settings": IconSettings,
  "bot-core.delete": IconTrash,
  "bot-core.archive": IconArchive,
  "bot-core.unarchive": IconUnarchive,
  "bot-core.show-archived": IconArchive,
  "bot-core.hide-archived": IconArchiveOff,
  "bot-core.entrust": IconManaged,
  "bot-core.release": IconManagedOff,
  "bot-core.answer-owner": IconUser,
  "bot-core.answer-main": IconManaged,
}

export function registerMenuIcons(ctx: ClientContext): void {
  ctx.effect(
    () =>
      ctx.slots.inject("contextMenu.icon", () => {
        const disposers = Object.entries(GLYPHS).map(([key, Icon]) =>
          ctx.slots.register({ name: "contextMenu.icon", key }, Icon),
        )
        return () => {
          for (const dispose of disposers) dispose()
        }
      }),
    "bot-core: menu icons",
  )
}
