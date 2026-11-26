import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import type { BotsSnapshot } from "../shared/bots"
import { BotGroup } from "./BotGroup"
import type { ActionProps } from "./face"
import { useObservable } from "./hooks"
import type { MessageKey } from "./i18n"
import { IconPlus, IconWrench } from "./icons"
import type { Observable } from "./observable"
import { PendingBotRow } from "./PendingBotRow"
import { keepFirstInRegion } from "./placement"
import { type BotsState, type RegistrationStatus, snapshotOf } from "./session-classification"
import {
  REGISTRATION_TARGETS,
  type Registrations,
  type RegistrationTarget,
} from "./slot-registration"
import {
  deriveTreeNodes,
  flattenTree,
  rovingKey,
  selectedKey,
  type TreeActivation,
  treeKeyAction,
} from "./tree"
import type { Translate } from "./types"

export { CreateBotDialog } from "./CreateBotDialog"
export type { ActionProps, BotsFace } from "./face"

export function BotsAction(props: ActionProps & { children: ReactNode }) {
  const { wide, children } = props
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [fallback, setFallback] = useState(false)

  useLayoutEffect(() => {
    if (!wide) return
    const element = document.createElement("div")
    element.className = "dshb-portal"
    let lost = false
    const dispose = keepFirstInRegion(element, () => {
      lost = true
      setFallback(true)
    })
    if (!lost) setHost(element)
    return () => {
      dispose()
      setHost(null)
      setFallback(false)
    }
  }, [wide])

  if (!wide) return children
  if (host !== null && !fallback) {
    return (
      <>
        {children}
        {createPortal(<BotsSection {...props} />, host)}
      </>
    )
  }
  return (
    <div className="dshb-stack">
      <div className="dshb-newrow">{children}</div>
      {fallback && <BotsSection {...props} />}
    </div>
  )
}

export function BotsSection(props: ActionProps) {
  const { t } = props
  const state = useObservable(props.bots)
  const creating = useObservable(props.createDialog)
  const attention = useObservable(props.globalSettingsAttention)
  const snapshot = snapshotOf(state)
  const settingsLabel =
    attention === null
      ? t("section.globalSettings")
      : `${t("section.globalSettings")}: ${attention.label(t)}`
  return (
    <section className="dshb-section" aria-label={t("section.label")}>
      <div className="dshb-header">
        <span className="dshb-header-label">{t("section.label")}</span>
        <button
          type="button"
          className="dshb-icon-button"
          title={settingsLabel}
          aria-label={settingsLabel}
          aria-haspopup="dialog"
          data-dshb-global-settings-open=""
          data-dshb-global-settings-attention={attention?.tone}
          onClick={() => props.openGlobalSettings()}
        >
          <IconWrench />
        </button>
        <button
          type="button"
          className="dshb-icon-button"
          title={t("section.new")}
          aria-label={t("section.new")}
          aria-expanded={creating}
          disabled={state.status === "unavailable" || state.status === "failed"}
          aria-haspopup="dialog"
          data-dshb-new-bot=""
          onClick={() => props.createDialog.set(true)}
        >
          <IconPlus />
        </button>
      </div>
      <div className="dshb-list">
        <RegistrationNotices t={t} registrations={props.registrations} />
        <BotsStatus t={t} state={state} />
        {snapshot !== undefined && snapshot.bots.length + snapshot.pending.length > 0 && (
          <BotsTree {...props} snapshot={snapshot} />
        )}
      </div>
    </section>
  )
}

function BotsStatus({ t, state }: { t: Translate; state: BotsState }) {
  switch (state.status) {
    case "loading":
      return <div className="dshb-note">{t("section.loading")}</div>
    case "ready":
      return state.snapshot.bots.length + state.snapshot.pending.length === 0 ? (
        <div className="dshb-note">{t("section.empty")}</div>
      ) : null
    case "reconnecting":
      return (
        <div className="dshb-note" role="status" data-dshb-reconnecting="">
          {t("bots.reconnecting")}
        </div>
      )
    case "unavailable":
      return (
        <div className="dshb-note">
          {t("section.unavailable")}
          {state.error !== undefined && <span className="dshb-detail">{state.error}</span>}
        </div>
      )
    case "failed":
      return (
        <div className="dshb-note" role="alert" data-dshb-remote-failed="">
          {t("section.failed")}
          <span className="dshb-detail">{state.error}</span>
        </div>
      )
  }
}

const REFUSED_KEYS: { readonly [Target in RegistrationTarget]: MessageKey } = {
  shell: "registration.refused.shell",
  rightbar: "registration.refused.rightbar",
  modelSeat: "registration.refused.modelSeat",
  permissionSeat: "registration.refused.permissionSeat",
}

function RegistrationNotices({ t, registrations }: { t: Translate; registrations: Registrations }) {
  return (
    <>
      {REGISTRATION_TARGETS.map((target) => (
        <RegistrationNotice key={target} t={t} target={target} status={registrations[target]} />
      ))}
    </>
  )
}

function RegistrationNotice(props: {
  t: Translate
  target: RegistrationTarget
  status: Observable<RegistrationStatus>
}) {
  const status = useObservable(props.status)
  if (status.state !== "refused") return null
  return (
    <div className="dshb-note" role="alert" data-dshb-registration-refused={props.target}>
      {props.t(REFUSED_KEYS[props.target])}
      <span className="dshb-detail">{status.error}</span>
    </div>
  )
}

function BotsTree(props: ActionProps & { snapshot: BotsSnapshot }) {
  const { snapshot: bots, ...face } = props
  const { t, setExpanded, windows } = face
  const list = useObservable(props.sessions)
  const snapshot = useObservable(props.workspaces)
  const expansion = useObservable(props.expansion)
  const archivedShown = useObservable(props.archivedView)
  const windowed = useObservable(windows)
  const progress = useObservable(props.progress)
  const [focused, setFocused] = useState<string | undefined>(undefined)
  const treeRef = useRef<HTMLDivElement>(null)

  const nodes = deriveTreeNodes(
    bots.bots,
    bots.pending,
    list,
    snapshot,
    { expansion, archivedShown, windows: windowed },
    progress,
  )
  useEffect(() => {
    for (const node of nodes) {
      if (node.kind === "bot" && node.expanded) windows.raise(node.bot.id, node.window)
    }
  })

  const activate = (target: TreeActivation) => {
    switch (target.kind) {
      case "session":
        face.openSession(target.sessionId)
        break
      case "archived":
        face.notifyArchivedNotOpenable()
        break
      case "progress":
        face.openProgress(target.botId)
        break
      case "overflow":
        windows.toggle(target.botId, target.overflow, target.window)
        break
      case "none":
        break
    }
  }
  const items = flattenTree(nodes)
  const tabKey = rovingKey(items, focused, selectedKey(nodes))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = event.target as HTMLElement
    const key = row.dataset.dshbKey
    if (key === undefined || row.getAttribute("role") !== "treeitem") return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    const action = treeKeyAction(items, key, event.key)
    if (action === undefined) return
    event.preventDefault()
    switch (action.kind) {
      case "focus":
        setFocused(action.key)
        treeRef.current
          ?.querySelector<HTMLElement>(`[data-dshb-key="${CSS.escape(action.key)}"]`)
          ?.focus()
        break
      case "expand":
      case "collapse":
        setExpanded(action.item.botId, action.kind === "expand")
        break
      case "activate":
        activate(action.item.activates)
        break
    }
  }

  return (
    <div
      ref={treeRef}
      className="dshb-tree"
      role="tree"
      aria-label={t("section.label")}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const key = (event.target as HTMLElement).dataset.dshbKey
        if (key !== undefined) setFocused(key)
      }}
    >
      {nodes.map((node, index) =>
        node.kind === "bot" ? (
          <BotGroup
            key={node.key}
            node={node}
            tabKey={tabKey}
            index={index}
            count={nodes.length}
            {...face}
          />
        ) : (
          <PendingBotRow
            key={node.key}
            node={node}
            tabKey={tabKey}
            index={index}
            count={nodes.length}
            {...face}
          />
        ),
      )}
    </div>
  )
}
