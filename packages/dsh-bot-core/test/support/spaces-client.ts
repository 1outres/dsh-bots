import type { PanelInfo } from "../../src/client/dsh/layout"
import { createStore } from "../../src/client/observable"
import type { BotsState } from "../../src/client/session-classification"
import type { SpacesFace } from "../../src/client/spaces/face"
import type { SpacesState } from "../../src/client/spaces/feed"
import type { SpaceFlows } from "../../src/client/spaces/flows"
import type { SpaceFrame } from "../../src/client/spaces/frame"
import type { BotSpacesView, BotSpaceView } from "../../src/shared/spaces"
import { value } from "./client"

export const spaceView = (botId: string, slug: string, fields: Partial<BotSpaceView> = {}) =>
  ({
    id: `${botId}:${slug}`,
    botId,
    slug,
    title: `Space ${slug}`,
    description: "",
    pinned: false,
    visibility: "owner",
    visitorWrites: false,
    revision: { number: 1, publishedAt: 0, files: 1, bytes: 100 },
    links: [],
    publicUrl: null,
    kv: { keys: 0, bytes: 0 },
    viewers: 0,
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  }) satisfies BotSpaceView

export const spacesReady = (spaces: readonly BotSpaceView[]): SpacesState => ({
  status: "ready",
  view: {
    spaces,
    settings: { publicBaseUrl: null, suggestedBaseUrl: null },
  } satisfies BotSpacesView,
})

const refuse = () => Promise.reject(new Error("idle"))

export const idleFlows: SpaceFlows = {
  setPinned: refuse,
  setVisibility: refuse,
  setVisitorWrites: refuse,
  discard: refuse,
  createLink: refuse,
  revokeLink: refuse,
  openInNewTab: refuse,
}

export function fakeSpacesFace(
  options: {
    readonly state?: SpacesState
    readonly bots?: BotsState
    readonly panel?: PanelInfo
    readonly flows?: Partial<SpaceFlows>
    readonly openFrame?: (spaceId: string) => SpaceFrame
  } = {},
): SpacesFace & { readonly opened: string[] } {
  const opened: string[] = []
  const expansion = createStore<Readonly<Record<string, boolean>>>({})
  return {
    opened,
    feed: value(options.state ?? { status: "loading" }),
    bots: value<BotsState>(options.bots ?? { status: "loading" }),
    panel: value<PanelInfo>(options.panel ?? { activePanelId: null }),
    flows: { ...idleFlows, ...options.flows },
    confirm: async () => true,
    spacesExpansion: {
      getSnapshot: expansion.getSnapshot,
      subscribe: expansion.subscribe,
      set: (botId, on) => expansion.update((current) => ({ ...current, [botId]: on })),
    },
    menuSpace: value<string | undefined>(undefined),
    openSpace: (space) => opened.push(space.id),
    openSpaceSettings() {},
    openSpaceMenu() {},
    openFrame:
      options.openFrame ??
      (() => {
        throw new Error("no frame")
      }),
    errors: value<Readonly<Record<string, string>>>({}),
    run(_space, action) {
      void action().catch(() => {})
    },
    clearError() {},
  }
}
