import type { KeyboardEvent, MouseEvent } from "react"
import type { GroupPlace } from "../BotSessionRow"
import { useObservable } from "../hooks"
import { IconClose, IconPin, IconPinOff, IconTriangleRight } from "../icons"
import { localeFormat } from "../locale-format"
import type { SpacesNode, SpaceTreeRow } from "../tree"
import type { Translate } from "../types"
import { Button } from "../ui/Button"
import { Tag } from "../ui/Tag"
import type { SpacesFace } from "./face"

const rowRect = (element: Element) => element.getBoundingClientRect()
const stop = (event: MouseEvent) => event.stopPropagation()

export function SpaceRowError(props: {
  readonly t: Translate
  readonly message: string
  onDismiss(): void
}) {
  return (
    <div className="dshb-row-error" role="alert" data-dshb-space-error="">
      <span className="dshb-row-error-text">{props.message}</span>
      <Button variant="icon" label={props.t("error.dismiss")} onClick={props.onDismiss}>
        <IconClose size={12} />
      </Button>
    </div>
  )
}

export function BotSpacesRows(props: {
  readonly t: Translate
  readonly botId: string
  readonly node: SpacesNode
  readonly place: GroupPlace
  readonly spaces: SpacesFace
}) {
  const { t, botId, node, place, spaces } = props
  const label = t("spaces.title")
  const count = localeFormat(t).count("spaces.count", node.rows.length)
  const rowSelected = !node.expanded && node.childSelected
  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: - */}
      <div
        className="dshb-row dshb-session-row dshb-spaces-row"
        role="treeitem"
        aria-level={2}
        aria-setsize={place.size}
        aria-posinset={place.position}
        aria-expanded={node.expanded}
        aria-selected={rowSelected}
        aria-label={label}
        aria-description={count}
        tabIndex={place.tabKey === node.key ? 0 : -1}
        data-dshb-key={node.key}
        data-selected={rowSelected ? "" : undefined}
        title={count}
        onClick={() => spaces.spacesExpansion.set(botId, !node.expanded)}
      >
        <span className="dshb-main-mark dshb-toggle" data-open={node.expanded ? "" : undefined}>
          <span className="dshb-spaces-chevron">
            <IconTriangleRight />
          </span>
        </span>
        <span className="dshb-title">{label}</span>
        <span className="dshb-spaces-count">{node.rows.length}</span>
      </div>
      {node.expanded && (
        // biome-ignore lint/a11y/useSemanticElements: -
        <div className="dshb-children" role="group" aria-label={label}>
          {node.rows.map((row, index) => (
            <SpaceRow
              key={row.key}
              t={t}
              row={row}
              spaces={spaces}
              place={{ position: index + 1, size: node.rows.length, tabKey: place.tabKey }}
            />
          ))}
        </div>
      )}
    </>
  )
}

function SpaceRow(props: {
  readonly t: Translate
  readonly row: SpaceTreeRow
  readonly place: GroupPlace
  readonly spaces: SpacesFace
}) {
  const { t, row, place, spaces } = props
  const { space } = row
  const menuOpen = useObservable(spaces.menuSpace) === space.id
  const error = useObservable(spaces.errors)[space.id]
  const openMenu = (point: { x: number; y: number }) => spaces.openSpaceMenu(space, point)
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.repeat) return
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return
    event.preventDefault()
    const rect = rowRect(event.currentTarget)
    openMenu({ x: rect.left, y: rect.bottom })
  }
  const pinLabel = space.pinned ? t("spaces.unpin") : t("spaces.pin")
  return (
    <>
      <div
        className="dshb-row dshb-session-row dshb-space-row"
        role="treeitem"
        aria-level={3}
        aria-setsize={place.size}
        aria-posinset={place.position}
        aria-selected={row.selected}
        aria-label={space.title}
        tabIndex={place.tabKey === row.key ? 0 : -1}
        data-dshb-key={row.key}
        data-dshb-space={space.id}
        data-selected={row.selected ? "" : undefined}
        data-menu-open={menuOpen ? "" : undefined}
        title={space.title}
        onClick={() => spaces.openSpace(space)}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          event.preventDefault()
          openMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        <span className="dshb-main-mark">
          {space.pinned && (
            <span role="img" aria-label={t("spaces.pinned")} title={t("spaces.pinned")}>
              <IconPin size={12} />
            </span>
          )}
        </span>
        <span className="dshb-title">{space.title}</span>
        {space.visibility === "public" && (
          <Tag marks={{ "data-dshb-space-public": "" }}>{t("spaces.public")}</Tag>
        )}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: - */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: - */}
        <span className="dshb-row-actions" onClick={stop}>
          <button
            type="button"
            className="dshb-row-button"
            tabIndex={-1}
            aria-label={pinLabel}
            title={pinLabel}
            aria-pressed={space.pinned}
            data-dshb-space-pin={space.pinned ? "pinned" : "unpinned"}
            onClick={() => spaces.run(space, () => spaces.flows.setPinned(space, !space.pinned))}
          >
            {space.pinned ? <IconPinOff size={14} /> : <IconPin size={14} />}
          </button>
        </span>
      </div>
      {error !== undefined && (
        <SpaceRowError t={t} message={error} onDismiss={() => spaces.clearError(space.id)} />
      )}
    </>
  )
}
