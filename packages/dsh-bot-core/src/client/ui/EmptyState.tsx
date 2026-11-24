import type { ReactNode } from "react"
import type { DataMarks } from "./marks"

export interface EmptyStateProps {
  readonly icon: ReactNode
  /** One short line. */
  readonly title: string
  /** One short line under the title: a reason or a state, never instructions. */
  readonly detail?: ReactNode
  /** At most one `Button`. */
  readonly action?: ReactNode
  readonly marks?: DataMarks
}

/** Nothing to show yet: centered icon, title and at most one button. */
export function EmptyState({ icon, title, detail, action, marks }: EmptyStateProps) {
  return (
    <div className="dshb-ui-empty" {...marks}>
      <span className="dshb-ui-empty-icon">{icon}</span>
      <p className="dshb-ui-empty-title">{title}</p>
      {detail !== undefined && <div className="dshb-ui-empty-detail">{detail}</div>}
      {action}
    </div>
  )
}

/** A failure that stops a page or a group from showing (`*.unavailable`, `*.failed`). */
export function ErrorText({ children }: { readonly children: ReactNode }) {
  return (
    <p className="dshb-ui-error" role="alert">
      {children}
    </p>
  )
}
