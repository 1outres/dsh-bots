import type {
  BotSpaceLinkCreated,
  BotSpaceLinkRequest,
  BotSpaceView,
  SpaceVisibility,
} from "../../shared/spaces"
import type { FrameConfirmation } from "../settings-frame/flow"
import type { Translate } from "../types"
import type { SpacesApi } from "./feed"
import { NEW_TAB_LINK_DAYS } from "./model"

export type SpaceConfirm = (request: FrameConfirmation) => Promise<boolean>

export interface SpaceTab {
  navigate(url: string): void
  close(): void
}

export interface SpaceFlowDeps {
  readonly api: SpacesApi
  readonly t: Translate
  openTab(): SpaceTab | null
}

export class SpaceTabBlockedError extends Error {
  override readonly name = "SpaceTabBlockedError"
}

export interface SpaceFlows {
  setPinned(space: BotSpaceView, pinned: boolean): Promise<void>
  setVisibility(
    space: BotSpaceView,
    visibility: SpaceVisibility,
    confirm: SpaceConfirm,
  ): Promise<void>
  setVisitorWrites(space: BotSpaceView, allowed: boolean, confirm: SpaceConfirm): Promise<void>
  discard(space: BotSpaceView, confirm: SpaceConfirm): Promise<boolean>
  createLink(space: BotSpaceView, request: BotSpaceLinkRequest): Promise<BotSpaceLinkCreated>
  revokeLink(space: BotSpaceView, linkId: string): Promise<void>
  openInNewTab(space: BotSpaceView): Promise<void>
}

export function createSpaceFlows(deps: SpaceFlowDeps): SpaceFlows {
  const { api, t } = deps
  return {
    async setPinned(space, pinned) {
      await api.setPinned(space.id, pinned)
    },
    async setVisibility(space, visibility, confirm) {
      if (visibility === space.visibility) return
      if (visibility === "public") {
        const confirmed = await confirm({
          title: t("spaces.confirm.public.title", { title: space.title }),
          description: t("spaces.confirm.public.description"),
          confirm: t("spaces.confirm.public.accept"),
          tone: "primary",
        })
        if (!confirmed) return
      }
      await api.setVisibility(space.id, visibility)
    },
    async setVisitorWrites(space, allowed, confirm) {
      if (allowed === space.visitorWrites) return
      if (allowed) {
        const confirmed = await confirm({
          title: t("spaces.confirm.writes.title", { title: space.title }),
          description: t("spaces.confirm.writes.description"),
          confirm: t("spaces.confirm.writes.accept"),
          tone: "primary",
        })
        if (!confirmed) return
      }
      await api.setVisitorWrites(space.id, allowed)
    },
    async discard(space, confirm) {
      const confirmed = await confirm({
        title: t("spaces.confirm.discard.title", { title: space.title }),
        description: t("spaces.confirm.discard.description"),
        confirm: t("spaces.confirm.discard.accept"),
        tone: "danger",
      })
      if (!confirmed) return false
      await api.discard(space.id)
      return true
    },
    createLink: (space, request) => api.createLink(space.id, request),
    async revokeLink(space, linkId) {
      await api.revokeLink(space.id, linkId)
    },
    async openInNewTab(space) {
      const tab = deps.openTab()
      if (tab === null) throw new SpaceTabBlockedError("the browser blocked the new tab")
      try {
        const link = await api.createLink(space.id, {
          label: t("spaces.link.webUi"),
          days: NEW_TAB_LINK_DAYS,
        })
        tab.navigate(link.relativeUrl)
      } catch (error) {
        tab.close()
        throw error
      }
    },
  }
}
