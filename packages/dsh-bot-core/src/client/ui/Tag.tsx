import type { ReactNode } from "react"
import type { DataMarks } from "./marks"

export function Tag({
  children,
  marks,
}: {
  readonly children: ReactNode
  readonly marks?: DataMarks
}) {
  return (
    <span className="dshb-ui-tag" {...marks}>
      {children}
    </span>
  )
}

export function Code({ children }: { readonly children: string }) {
  return <code className="dshb-ui-code">{children}</code>
}
