import { type ReactNode, useId } from "react"
import type { DataMarks } from "./marks"

export interface GroupProps {
  readonly title?: ReactNode
  readonly tag?: ReactNode
  readonly aside?: ReactNode
  readonly children: ReactNode
  readonly marks?: DataMarks
}

export function Group({ title, tag, aside, children, marks }: GroupProps) {
  const id = useId()
  return (
    <section
      className="dshb-ui-group"
      aria-labelledby={title === undefined ? undefined : id}
      {...marks}
    >
      {title !== undefined && (
        <div className="dshb-ui-group-head">
          <h4 className="dshb-ui-group-title" id={id}>
            <span className="dshb-ui-heading-text">{title}</span>
            {tag}
          </h4>
          {aside}
        </div>
      )}
      <div className="dshb-ui-group-frame">{children}</div>
    </section>
  )
}

export function PageTitle({
  children,
  tag,
  trailing,
}: {
  readonly children: ReactNode
  readonly tag?: ReactNode
  readonly trailing?: ReactNode
}) {
  return (
    <div className="dshb-ui-page-title">
      <h3 className="dshb-ui-page-heading">
        <span className="dshb-ui-heading-text">{children}</span>
        {tag}
      </h3>
      {trailing !== undefined && <div className="dshb-ui-row-trailing">{trailing}</div>}
    </div>
  )
}
