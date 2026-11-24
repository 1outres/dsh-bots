import type { DataMarks } from "./marks"

/** `busy` animates its dot (connecting, preparing). */
export type PillTone = "success" | "warning" | "danger" | "idle" | "busy"

export interface StatusPillProps {
  readonly tone: PillTone
  /** One short word or two (Connected, Not set). */
  readonly label: string
  readonly marks?: DataMarks
}

/** A state: a 6px dot in the tone's colour and a short word. */
export function StatusPill({ tone, label, marks }: StatusPillProps) {
  return (
    <span className="dshb-ui-pill" data-tone={tone} {...marks}>
      <span className="dshb-ui-pill-dot" aria-hidden="true" />
      {label}
    </span>
  )
}
