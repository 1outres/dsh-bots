import { createElement } from "react"
import { createBotFlagStore } from "../bot-flags"
import { SLOT } from "../dsh/slots"
import { IconSpace } from "../icons"
import { createStore, derive, type Observable } from "../observable"
import type { RemoteMount } from "../remote"
import { type BotsState, snapshotOf } from "../session-classification"
import { createSpaceConfirmations } from "../spaces/confirm"
import type { SpacesFace } from "../spaces/face"
import { spaceErrorText } from "../spaces/failure-text"
import { spacesViewOf, watchSpaces } from "../spaces/feed"
import { createSpaceFlows, type SpaceTab } from "../spaces/flows"
import { createSpaceFrame } from "../spaces/frame"
import { createSpaceMenuOpener, registerSpaceMenu } from "../spaces/menu"
import { findSpace, type SpaceSlotEntry, spacePanelId, spaceSlotEntries } from "../spaces/model"
import { SPACES_GLOBAL_SECTION, SPACES_SECTION, spaceDetailOf } from "../spaces/pages"
import { reconcileSpaceSlots } from "../spaces/registrar"
import { SpaceConfirmView } from "../spaces/SpaceConfirmView"
import { SpacePanel, type SpacePanelFace } from "../spaces/SpacePanel"
import { SpacePanelIcon, type SpacePanelIconFace } from "../spaces/SpacePanelIcon"
import { SpacesSection } from "../spaces/SpacesSection"
import { SpacesSettings } from "../spaces/SpacesSettings"
import type { ClientContext } from "../types"
import { overlay } from "./dialogs"
import { NAMESPACE } from "./plugin"
import type { SettingsScreens } from "./screens"

export const SPACES_EXPANDED_KEY = "dsh-bots:spaces-expanded"

export interface SpacesSources {
  readonly remote: Promise<RemoteMount>
  readonly bots: Observable<BotsState>
  readonly screens: Pick<SettingsScreens, "bot" | "global" | "openSettings">
}

export interface SpacesWiring {
  readonly face: SpacesFace
  readonly asking: Observable<unknown>
}

const sameEntries = (a: readonly SpaceSlotEntry[], b: readonly SpaceSlotEntry[]) =>
  JSON.stringify(a) === JSON.stringify(b)

function openBrowserTab(): SpaceTab | null {
  const tab = window.open("", "_blank")
  if (tab === null) return null
  tab.opener = null
  return {
    navigate: (url) => tab.location.replace(new URL(url, window.location.href).href),
    close: () => tab.close(),
  }
}

export function wireSpaces(ctx: ClientContext, sources: SpacesSources): SpacesWiring {
  const { bots, screens } = sources
  const t = ctx.locale.bind(NAMESPACE)
  const feed = watchSpaces(sources.remote, ctx.connection.generation)
  ctx.effect(() => () => feed.dispose(), "bot-core: Spaces feed")
  const confirmations = createSpaceConfirmations()
  const errors = createStore<Readonly<Record<string, string>>>({})
  const setError = (spaceId: string, message: string | undefined) =>
    errors.update((current) => {
      const { [spaceId]: _gone, ...rest } = current
      return message === undefined ? rest : { ...rest, [spaceId]: message }
    })
  const flows = createSpaceFlows({ api: feed, t, openTab: openBrowserTab })
  const menu = createSpaceMenuOpener(ctx.contextMenus)

  const face: SpacesFace = {
    feed,
    bots,
    panel: ctx.layout.panelInfo,
    flows,
    confirm: confirmations.confirm,
    spacesExpansion: createBotFlagStore(SPACES_EXPANDED_KEY),
    menuSpace: menu.menuSpace,
    openSpace(space) {
      try {
        ctx.layout.selectPanel(spacePanelId(space))
        setError(space.id, undefined)
      } catch (error) {
        setError(space.id, spaceErrorText(t, error))
      }
    },
    openSpaceSettings: (space, intent) =>
      screens.openSettings(space.botId, SPACES_SECTION, spaceDetailOf(space.id, intent)),
    openSpaceMenu: menu.openSpaceMenu,
    openFrame: (spaceId) =>
      createSpaceFrame({
        fetch: () => feed.frame(spaceId),
        revision: derive(
          [feed],
          (state) =>
            findSpace(spacesViewOf(state)?.spaces ?? [], spaceId)?.revision?.number ?? null,
        ),
        generation: ctx.connection.generation,
        now: () => Date.now(),
        later: (ms, run) => {
          const timer = setTimeout(run, ms)
          return () => clearTimeout(timer)
        },
      }),
    errors,
    run(space, action) {
      setError(space.id, undefined)
      action().then(
        () => {},
        (error: unknown) => setError(space.id, spaceErrorText(t, error)),
      )
    },
    clearError: (spaceId) => setError(spaceId, undefined),
  }

  const entries = derive(
    [feed, bots],
    (state, botsState) =>
      spaceSlotEntries(spacesViewOf(state)?.spaces ?? [], snapshotOf(botsState)?.bots ?? []),
    sameEntries,
  )
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT.main, () =>
        ctx.slots.inject(SLOT.panelList, () =>
          reconcileSpaceSlots(entries, {
            main: (entry) =>
              ctx.slots.register(
                {
                  name: SLOT.main,
                  key: entry.id,
                  locale: NAMESPACE,
                  inject: () => ({ spaces: face, spaceId: entry.spaceId }) satisfies SpacePanelFace,
                },
                SpacePanel,
              ),
            panel: (entry) =>
              ctx.slots.register(
                {
                  name: SLOT.panelList,
                  id: entry.id,
                  order: entry.order,
                  locale: NAMESPACE,
                  label: () => entry.label,
                  inject: () => ({ bots, botId: entry.botId }) satisfies SpacePanelIconFace,
                },
                SpacePanelIcon,
              ),
          }),
        ),
      ),
    "bot-core: Space panels",
  )

  registerSpaceMenu(ctx, face, t)
  overlay(ctx, "bot-core.space-confirm", () => ({ confirmations }), SpaceConfirmView)
  ctx.effect(
    () =>
      screens.bot.sections.register({
        id: SPACES_SECTION,
        order: 470,
        label: (translate) => translate("spaces.title"),
        icon: IconSpace,
        component: (props) => createElement(SpacesSection, { ...props, spaces: face }),
      }),
    "bot-core: Spaces of a bot",
  )
  ctx.effect(
    () =>
      screens.global.sections.register({
        id: SPACES_GLOBAL_SECTION,
        order: 300,
        label: (translate) => translate("spaces.title"),
        icon: IconSpace,
        component: (props) =>
          createElement(SpacesSettings, {
            ...props,
            feed,
            setPublicBaseUrl: feed.setPublicBaseUrl,
          }),
      }),
    "bot-core: Spaces settings",
  )
  return { face, asking: confirmations.asking }
}
