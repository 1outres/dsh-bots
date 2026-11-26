import type { BotSpaceView } from "../../shared/spaces"
import type { MenuPoint } from "../menu"
import { MENU_ICON } from "../menu-icons"
import { derive, type Observable } from "../observable"
import type { ClientContext, ContextMenus, MenuAction, MenuTarget, Translate } from "../types"
import type { SpacesFace } from "./face"
import { spacesViewOf } from "./feed"
import { findSpace } from "./model"

export const SPACE_MENU_TARGET = "bot-space"

export interface SpaceMenuValue {
  readonly spaceId: string
  readonly displayTitle: string
}

export const spaceMenuTarget = (space: BotSpaceView): MenuTarget => ({
  kind: SPACE_MENU_TARGET,
  value: { spaceId: space.id, displayTitle: space.title } satisfies SpaceMenuValue,
})

export function menuTargetSpaceId(target: MenuTarget | null): string | undefined {
  if (target?.kind !== SPACE_MENU_TARGET) return undefined
  const value = target.value as Partial<SpaceMenuValue> | null
  return typeof value?.spaceId === "string" ? value.spaceId : undefined
}

export interface SpaceMenuOpener {
  readonly menuSpace: Observable<string | undefined>
  openSpaceMenu(space: BotSpaceView, point: MenuPoint): void
}

export function createSpaceMenuOpener(
  menus: Pick<ContextMenus, "active" | "open">,
): SpaceMenuOpener {
  return {
    menuSpace: derive([menus.active], menuTargetSpaceId),
    openSpaceMenu: (space, point) => menus.open(spaceMenuTarget(space), point),
  }
}

export type SpaceMenuFace = Pick<
  SpacesFace,
  "flows" | "confirm" | "run" | "openSpaceSettings" | "openSpace"
>

export function spaceMenuActions(
  space: BotSpaceView,
  face: SpaceMenuFace,
  t: Translate,
): MenuAction[] {
  const run = (action: () => Promise<unknown>) => () => face.run(space, action)
  return [
    {
      id: "pin",
      label: t(space.pinned ? "spaces.menu.unpin" : "spaces.menu.pin"),
      icon: { key: space.pinned ? MENU_ICON.unpin : MENU_ICON.pin },
      run: run(() => face.flows.setPinned(space, !space.pinned)),
    },
    {
      id: "open-tab",
      label: t("spaces.openTab"),
      icon: { key: MENU_ICON.openTab },
      disabled: space.revision === null,
      run: run(() => face.flows.openInNewTab(space)),
    },
    {
      id: "link",
      label: t("spaces.menu.createLink"),
      icon: { key: MENU_ICON.link },
      run: () => face.openSpaceSettings(space, "link"),
    },
    space.visibility === "public"
      ? {
          id: "visibility",
          label: t("spaces.menu.makePrivate"),
          icon: { key: MENU_ICON.makePrivate },
          run: run(() => face.flows.setVisibility(space, "owner", face.confirm)),
        }
      : {
          id: "visibility",
          label: t("spaces.menu.makePublic"),
          icon: { key: MENU_ICON.makePublic },
          run: run(() => face.flows.setVisibility(space, "public", face.confirm)),
        },
    {
      id: "settings",
      label: t("spaces.menu.settings"),
      icon: { key: MENU_ICON.settings },
      separatorBefore: true,
      run: () => face.openSpaceSettings(space),
    },
    {
      id: "delete",
      label: t("spaces.menu.delete"),
      icon: { key: MENU_ICON.delete },
      danger: true,
      separatorBefore: true,
      run: run(() => face.flows.discard(space, face.confirm)),
    },
  ]
}

export function registerSpaceMenu(
  ctx: ClientContext,
  face: SpaceMenuFace & Pick<SpacesFace, "feed">,
  t: Translate,
): void {
  ctx.effect(
    () =>
      ctx.contextMenus.register({
        id: "bot-core.space-actions",
        target: SPACE_MENU_TARGET,
        order: 100,
        observe: () => [face.feed],
        resolve: (target: SpaceMenuValue) => {
          const space = findSpace(
            spacesViewOf(face.feed.getSnapshot())?.spaces ?? [],
            target.spaceId,
          )
          return space === undefined ? [] : spaceMenuActions(space, face, t)
        },
      }),
    "bot-core: Space row menu",
  )
}
