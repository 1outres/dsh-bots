import type { KeyboardEvent, ReactNode, Ref } from "react"
import { IconClose } from "../icons"
import type { DataMarks } from "../ui"

/** What every frame of a shell panel takes, side panel or popover. */
export interface PanelFrameProps {
  /** The panel's accessible name. */
  readonly label: string
  readonly title: string
  /** The title's tooltip, when it differs from the title (a file's path). */
  readonly titleHint?: string
  readonly titleRef?: Ref<HTMLHeadingElement>
  /** Before the title (a back button). */
  readonly leading?: ReactNode
  /** Between the title and the close button (a state, a refresh button). */
  readonly trailing?: ReactNode
  readonly closeLabel: string
  onClose(): void
  readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  readonly marks: DataMarks
  readonly children: ReactNode
}

/** A panel's header, on the shell header's line: its title and close button. */
export function PanelHeader(
  props: Pick<
    PanelFrameProps,
    "title" | "titleHint" | "titleRef" | "leading" | "trailing" | "closeLabel" | "onClose"
  >,
) {
  return (
    <header className="dshb-panel-header">
      {props.leading}
      <h2
        ref={props.titleRef}
        className="dshb-panel-title"
        tabIndex={-1}
        title={props.titleHint ?? props.title}
      >
        {props.title}
      </h2>
      {props.trailing}
      <button
        type="button"
        className="dshb-shell-button"
        aria-label={props.closeLabel}
        title={props.closeLabel}
        onClick={props.onClose}
      >
        <IconClose size={16} />
      </button>
    </header>
  )
}
