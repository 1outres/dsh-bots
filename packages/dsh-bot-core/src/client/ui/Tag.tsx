import type { ReactNode } from "react"
import type { DataMarks } from "./marks"

/** A neutral chip for a fact (Main only, 4 GiB, DEV). */
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

/** A value to copy or read exactly (a redirect URI), in the code face. */
export function Code({ children }: { readonly children: string }) {
  return <code className="dshb-ui-code">{children}</code>
}
