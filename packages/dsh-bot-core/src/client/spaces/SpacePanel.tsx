import { useEffect, useState } from "react"
import type { BotView } from "../../shared/bots"
import type { BotSpaceView } from "../../shared/spaces"
import { Avatar } from "../Avatar"
import { useObservable } from "../hooks"
import { IconExternal, IconPin, IconPinOff, IconSpace } from "../icons"
import { snapshotOf } from "../session-classification"
import type { Translate } from "../types"
import { Button } from "../ui/Button"
import { EmptyState } from "../ui/EmptyState"
import { RowMenu, type RowMenuItem } from "../ui/RowMenu"
import { StatusPill } from "../ui/StatusPill"
import type { SpacesFace } from "./face"
import { spaceFailureText } from "./failure-text"
import { spacesViewOf } from "./feed"
import type { SpaceFrame, SpaceFrameState } from "./frame"
import { findSpace } from "./model"
import { SpaceRowError } from "./SpaceTreeRows"

export interface SpacePanelFace {
  readonly spaces: SpacesFace
  readonly spaceId: string
}

export const SPACE_FRAME_SANDBOX = "allow-scripts allow-forms"

export function SpacePanel(props: SpacePanelFace & { readonly t: Translate }) {
  const { t, spaces, spaceId } = props
  const view = spacesViewOf(useObservable(spaces.feed))
  const bots = snapshotOf(useObservable(spaces.bots))
  const space = view === undefined ? undefined : findSpace(view.spaces, spaceId)
  const bot = space === undefined ? undefined : bots?.bots.find((item) => item.id === space.botId)
  return (
    <div className="dshb-space-panel" data-dshb-space-panel={spaceId}>
      {space !== undefined && bot !== undefined && (
        <>
          <SpaceHeader t={t} spaces={spaces} space={space} bot={bot} />
          <SpaceBody t={t} spaces={spaces} space={space} />
        </>
      )}
    </div>
  )
}

function SpaceHeader(props: {
  readonly t: Translate
  readonly spaces: SpacesFace
  readonly space: BotSpaceView
  readonly bot: BotView
}) {
  const { t, spaces, space, bot } = props
  const error = useObservable(spaces.errors)[space.id]
  const run = (action: () => Promise<unknown>) => spaces.run(space, action)
  const pinLabel = space.pinned ? t("spaces.unpin") : t("spaces.pin")
  const items: RowMenuItem[] = [
    {
      id: "link",
      label: t("spaces.menu.createLink"),
      run: () => spaces.openSpaceSettings(space, "link"),
    },
    space.visibility === "public"
      ? {
          id: "visibility",
          label: t("spaces.menu.makePrivate"),
          run: () => run(() => spaces.flows.setVisibility(space, "owner", spaces.confirm)),
        }
      : {
          id: "visibility",
          label: t("spaces.menu.makePublic"),
          run: () => run(() => spaces.flows.setVisibility(space, "public", spaces.confirm)),
        },
    {
      id: "settings",
      label: t("spaces.menu.settings"),
      run: () => spaces.openSpaceSettings(space),
    },
    {
      id: "delete",
      label: t("spaces.menu.delete"),
      tone: "danger",
      run: () => run(() => spaces.flows.discard(space, spaces.confirm)),
    },
  ]
  return (
    <>
      <header className="dshb-shell-header dshb-space-header" data-window-drag="">
        <div className="dshb-shell-title">
          <span className="dshb-shell-face">
            <Avatar avatar={bot.avatar} size={24} />
          </span>
          <span className="dshb-shell-name" title={bot.name}>
            {bot.name}
          </span>
          <span className="dshb-shell-sep" aria-hidden="true">
            /
          </span>
          <h1 className="dshb-shell-name dshb-space-title" title={space.title} tabIndex={-1}>
            {space.title}
          </h1>
          {space.revision !== null && (
            <span className="dshb-space-meta" data-dshb-space-revision={space.revision.number}>
              {t("spaces.revision", { number: space.revision.number })}
            </span>
          )}
          <StatusPill
            tone={space.visibility === "public" ? "warning" : "idle"}
            label={t(
              space.visibility === "public"
                ? "spaces.visibility.public"
                : "spaces.visibility.owner",
            )}
            marks={{ "data-dshb-space-visibility": space.visibility }}
          />
        </div>
        <button
          type="button"
          className="dshb-shell-button"
          aria-label={pinLabel}
          title={pinLabel}
          aria-pressed={space.pinned}
          data-dshb-space-panel-pin={space.pinned ? "pinned" : "unpinned"}
          onClick={() => run(() => spaces.flows.setPinned(space, !space.pinned))}
        >
          {space.pinned ? <IconPinOff size={16} /> : <IconPin size={16} />}
        </button>
        <button
          type="button"
          className="dshb-shell-button"
          aria-label={t("spaces.openTab")}
          title={t("spaces.openTab")}
          disabled={space.revision === null}
          data-dshb-space-open-tab=""
          onClick={() => run(() => spaces.flows.openInNewTab(space))}
        >
          <IconExternal size={16} />
        </button>
        <RowMenu
          label={t("spaces.menu", { title: space.title })}
          items={items}
          marks={{ "data-dshb-space-panel-menu": "" }}
        />
      </header>
      {error !== undefined && (
        <div className="dshb-space-banner">
          <SpaceRowError t={t} message={error} onDismiss={() => spaces.clearError(space.id)} />
        </div>
      )}
    </>
  )
}

function useSpaceFrame(
  spaces: SpacesFace,
  spaceId: string,
): {
  readonly frame: SpaceFrame | undefined
  readonly state: SpaceFrameState
} {
  const [frame, setFrame] = useState<SpaceFrame | undefined>(undefined)
  const [state, setState] = useState<SpaceFrameState>({ status: "loading" })
  useEffect(() => {
    const opened = spaces.openFrame(spaceId)
    setFrame(opened)
    setState(opened.getSnapshot())
    const off = opened.subscribe(() => setState(opened.getSnapshot()))
    return () => {
      off()
      opened.dispose()
    }
  }, [spaces, spaceId])
  return { frame, state }
}

function SpaceBody(props: {
  readonly t: Translate
  readonly spaces: SpacesFace
  readonly space: BotSpaceView
}) {
  const { t, spaces, space } = props
  const { frame, state } = useSpaceFrame(spaces, space.id)
  return <SpaceFrameView t={t} space={space} state={state} onRetry={() => frame?.retry()} />
}

export function SpaceFrameView(props: {
  readonly t: Translate
  readonly space: BotSpaceView
  readonly state: SpaceFrameState
  onRetry(): void
}) {
  const { t, space, state } = props
  switch (state.status) {
    case "unpublished":
      return (
        <EmptyState
          icon={<IconSpace size={24} />}
          title={t("spaces.unpublished")}
          marks={{ "data-dshb-space-unpublished": "" }}
        />
      )
    case "loading":
      return <EmptyState icon={<IconSpace size={24} />} title={t("spaces.panel.opening")} />
    case "failed":
      return (
        <EmptyState
          icon={<IconSpace size={24} />}
          title={spaceFailureText(t, state.failure)}
          action={
            <Button variant="secondary" onClick={props.onRetry}>
              {t("spaces.panel.retry")}
            </Button>
          }
          marks={{ "data-dshb-space-frame-failed": state.failure.kind }}
        />
      )
    case "ready":
      return (
        <iframe
          key={`${state.url}#${state.load}`}
          className="dshb-space-frame"
          title={space.title}
          src={state.url}
          sandbox={SPACE_FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          data-dshb-space-frame={state.load}
        />
      )
  }
}
