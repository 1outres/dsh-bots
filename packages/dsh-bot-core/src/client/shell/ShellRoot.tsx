import { useObservable } from "../hooks"
import type { Translate } from "../types"
import { BotSessionShell } from "./BotSessionShell"
import { CreationProgress } from "./CreationProgress"
import type { ShellSlotProps } from "./face"
import { ShellBoundary } from "./ShellBoundary"
import { shellView } from "./shell-view"

export function ShellRoot(props: ShellSlotProps) {
  return (
    <ShellBoundary t={props.t}>
      <ShellContent {...props} />
    </ShellBoundary>
  )
}

function ShellContent(props: ShellSlotProps) {
  const view = shellView(
    props.sessionId,
    useObservable(props.classification),
    useObservable(props.progress),
  )
  switch (view.kind) {
    case "progress":
      return <CreationProgress {...props} botId={view.botId} />
    case "classifying":
      return <ClassifyingPlaceholder t={props.t} />
    case "stock":
      return null
    case "bot":
      return <BotSessionShell {...props} sessionId={view.sessionId} bot={view.bot} />
  }
}

export function ClassifyingPlaceholder({ t }: { readonly t: Translate }) {
  return (
    <div className="dshb-shell" data-dshb-shell-classifying="">
      <div className="dshb-shell-placeholder">
        <p role="status">{t("shell.classifying")}</p>
      </div>
    </div>
  )
}
