import type { DataMarks } from "./marks"

export type PillTone = "success" | "warning" | "danger" | "idle" | "busy"

export interface StatusPillProps {
  readonly tone: PillTone
  readonly label: string
  readonly marks?: DataMarks
}

export function StatusPill({ tone, label, marks }: StatusPillProps) {
  return (
    <span className="dshb-ui-pill" data-tone={tone} {...marks}>
      <span className="dshb-ui-pill-dot" aria-hidden="true" />
      {label}
    </span>
  )
}
