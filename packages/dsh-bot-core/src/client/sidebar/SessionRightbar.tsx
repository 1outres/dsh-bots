import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Translate } from "../dsh/context"
import type { SidebarRightFace, SidebarStoreProps, SidebarSurface } from "../dsh/sidebar-right"
import type { Viewer } from "../viewer"
import type { ClassifySession } from "./file-tab"
import type { LockdownReporter } from "./lockdown-status"
import { initialSweepMemory, planSweep, type SweepMemory } from "./sweep-plan"
import { runSweep } from "./sweep-run"

export interface SessionRightbarFace {
  readonly sidebar: SidebarRightFace
  readonly viewer: Viewer
  readonly classify: ClassifySession
  readonly lockdown: LockdownReporter
  openExternal(url: string): void
}

export type RightbarStore =
  | ({ readonly handle: "present" } & SidebarStoreProps)
  | { readonly handle: "missing" }

export type SessionRightbarProps = SessionRightbarFace &
  RightbarStore & {
    readonly t: Translate
    readonly sessionId: string | undefined
  }

type SweeperProps = Extract<SessionRightbarProps, { readonly handle: "present" }> & {
  readonly sessionId: string
}

export function SessionRightbar(props: SessionRightbarProps) {
  if (props.sessionId === undefined || props.handle === "missing") return null
  if (props.classify(props.sessionId).kind !== "bot") return null
  return <Sweeper {...props} sessionId={props.sessionId} />
}

function Sweeper(props: SweeperProps) {
  const { sessionId, useStore, actions } = props
  const surface = useStore((state): SidebarSurface | undefined => state.bySession[sessionId])
  const [initial] = useState(() => initialSweepMemory(surface))
  const memory = useRef<SweepMemory>(initial)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    if (surface === undefined) actions.open(sessionId)
  }, [actions, sessionId, surface])

  useLayoutEffect(() => {
    if (surface === undefined) return
    const swept = planSweep(surface, memory.current)
    memory.current = swept.memory
    const current = latest.current
    const outcome = runSweep(swept.plan, {
      sessionId,
      sidebar: current.sidebar,
      actions,
      viewer: current.viewer,
      openExternal: current.openExternal,
      t: current.t,
    })
    if (outcome.broken) current.lockdown.markBroken()
  }, [surface, sessionId, actions])
  return null
}
