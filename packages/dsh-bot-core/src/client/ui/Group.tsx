import { type ReactNode, useId } from "react"
import type { DataMarks } from "./marks"

export interface GroupProps {
  /** The group's `h4` title; a group without one continues the group above. */
  readonly title?: ReactNode
  /** Right after the title (a `Tag` such as DEV). */
  readonly tag?: ReactNode
  /** At the right of the title line (a row `Button`, a filter). */
  readonly aside?: ReactNode
  /** `Row`s, separated by hairlines. */
  readonly children: ReactNode
  readonly marks?: DataMarks
}

/** Rows that belong together: an optional title over a hairline frame. */
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

/** The title of a page or a detail page (`h3`), with its controls at the right. */
export function PageTitle({
  children,
  tag,
  trailing,
}: {
  readonly children: ReactNode
  /** Right after the title (a `Tag` such as DEV). */
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
