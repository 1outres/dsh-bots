import type { ReactNode } from "react"
import { IconChevronRight, IconExternal, IconPlus } from "../icons"
import type { DataMarks } from "./marks"

export interface RowProps {
  readonly label: ReactNode
  readonly meta?: ReactNode
  readonly metaTone?: "danger" | "warning"
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  readonly description?: string
  readonly density?: "regular" | "compact"
  readonly marks?: DataMarks
}

function RowText({ label, meta, metaTone, description }: RowProps) {
  return (
    <span className="dshb-ui-row-text">
      <span className="dshb-ui-row-label">{label}</span>
      {meta !== undefined && meta !== null && (
        <span className="dshb-ui-row-meta" data-tone={metaTone}>
          {meta}
        </span>
      )}
      {description !== undefined && <span className="dshb-sr">{description}</span>}
    </span>
  )
}

function rowAttributes(props: RowProps, kind: string) {
  return {
    className: "dshb-ui-row",
    "data-kind": kind,
    "data-density": props.density ?? "regular",
    title: props.description,
    ...props.marks,
  }
}

export function Row(props: RowProps) {
  return (
    <div {...rowAttributes(props, "plain")}>
      {props.leading !== undefined && <span className="dshb-ui-row-leading">{props.leading}</span>}
      <RowText {...props} />
      {props.trailing !== undefined && <div className="dshb-ui-row-trailing">{props.trailing}</div>}
    </div>
  )
}

export function BlockRow(props: RowProps & { readonly children: ReactNode }) {
  return (
    <div {...rowAttributes(props, "block")}>
      <div className="dshb-ui-row-line">
        {props.leading !== undefined && (
          <span className="dshb-ui-row-leading">{props.leading}</span>
        )}
        <RowText {...props} />
        {props.trailing !== undefined && (
          <div className="dshb-ui-row-trailing">{props.trailing}</div>
        )}
      </div>
      <div className="dshb-ui-row-block">{props.children}</div>
    </div>
  )
}

export function NavRow(props: RowProps & { onOpen(): void; readonly expanded?: boolean }) {
  return (
    <div {...rowAttributes(props, "open")} data-expanded={props.expanded === true ? "" : undefined}>
      {props.leading !== undefined && <span className="dshb-ui-row-leading">{props.leading}</span>}
      <button
        type="button"
        className="dshb-ui-row-open"
        aria-expanded={props.expanded}
        onClick={props.onOpen}
      >
        <RowText {...props} />
      </button>
      {props.trailing !== undefined && <div className="dshb-ui-row-trailing">{props.trailing}</div>}
      <span className="dshb-ui-row-chevron" aria-hidden="true">
        <IconChevronRight />
      </span>
    </div>
  )
}

export function LinkRow(props: Omit<RowProps, "trailing"> & { readonly href: string }) {
  return (
    <a
      {...rowAttributes(props, "link")}
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {props.leading !== undefined && <span className="dshb-ui-row-leading">{props.leading}</span>}
      <RowText {...props} />
      <span className="dshb-ui-row-chevron" aria-hidden="true">
        <IconExternal />
      </span>
    </a>
  )
}

export function AddRow({
  label,
  onAdd,
  disabled,
  marks,
}: {
  readonly label: string
  onAdd(): void
  readonly disabled?: boolean
  readonly marks?: DataMarks
}) {
  return (
    <button
      type="button"
      className="dshb-ui-add-row"
      disabled={disabled}
      onClick={onAdd}
      {...marks}
    >
      <IconPlus size={14} />
      {label}
    </button>
  )
}

export function ButtonRow({
  label,
  onClick,
  tone,
  disabled,
  marks,
}: {
  readonly label: string
  onClick(): void
  readonly tone?: "danger"
  readonly disabled?: boolean
  readonly marks?: DataMarks
}) {
  return (
    <button
      type="button"
      className="dshb-ui-row dshb-ui-button-row"
      data-kind="action"
      data-density="regular"
      data-tone={tone}
      disabled={disabled}
      onClick={onClick}
      {...marks}
    >
      <span className="dshb-ui-row-label">{label}</span>
    </button>
  )
}
