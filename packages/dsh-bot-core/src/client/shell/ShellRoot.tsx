import { useObservable } from "../hooks"
import type { Translate } from "../types"
import { BotSessionShell } from "./BotSessionShell"
import { CreationProgress } from "./CreationProgress"
import type { ShellSlotProps } from "./face"
import { ShellBoundary } from "./ShellBoundary"
import { shellView } from "./shell-view"

/**
 * bot-core's `main.conversation` entry. Everything sits in its own error
 * boundary; the Slot renderer remounts a session-maybe entry per session,
 * which resets the boundary too.
 */
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

/** Neutral until the session is known to be a bot's or not: no header, no menu. */
export function ClassifyingPlaceholder({ t }: { readonly t: Translate }) {
  return (
    <div className="dshb-shell" data-dshb-shell-classifying="">
      <div className="dshb-shell-placeholder">
        <p role="status">{t("shell.classifying")}</p>
      </div>
    </div>
  )
}
