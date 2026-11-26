import type { ReactNode } from "react"
import type { DataMarks } from "./marks"

export interface EmptyStateProps {
  readonly icon: ReactNode
  readonly title: string
  readonly detail?: ReactNode
  readonly action?: ReactNode
  readonly marks?: DataMarks
}

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

export function ErrorText({ children }: { readonly children: ReactNode }) {
  return (
    <p className="dshb-ui-error" role="alert">
      {children}
    </p>
  )
}
