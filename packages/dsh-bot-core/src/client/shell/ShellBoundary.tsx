import { Component, type ReactNode } from "react"
import type { Translate } from "../types"

interface BoundaryProps {
  readonly t: Translate
  readonly children: ReactNode
}

const COMPOSITION_ERRORS = new Set(["SlotAssemblyError", "HocContentError"])

/**
 * Blanks the session with a notice once its subtree throws, so a failure never
 * reaches the Slot renderer, whose fallback is DSH's stock shell.
 */
export class ShellBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: unknown): void {
    const name = error instanceof Error ? error.name : undefined
    if (name !== undefined && COMPOSITION_ERRORS.has(name)) {
      // DSH's own boundaries rethrow these; this one swallows them, so it names them.
      console.error(
        `bot-core: ${name} inside the bot session shell — a DSH Slot composition error, not a bot-core bug; the session is left blank`,
        error,
      )
      return
    }
    console.error("bot-core: the bot session shell failed; the session is left blank", error)
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="dshb-shell" data-dshb-shell-error="">
        <p className="dshb-shell-error" role="alert">
          {this.props.t("shell.error")}
        </p>
      </div>
    )
  }
}
