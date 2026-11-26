import type { ReactNode } from "react"
import type { BotView } from "../../shared/bots"
import { Avatar } from "../Avatar"
import { IconSettings } from "../icons"
import type { Translate } from "../types"
import type { ShellFace } from "./face"

interface HeaderParts {
  readonly t: Translate
  readonly sessionTitle: string | undefined
  readonly menuButton: ReactNode
}

export const SHELL_NAME_SELECTOR = "[data-dshb-shell-name]"

function HeaderFrame(
  props: HeaderParts & { readonly children: ReactNode; readonly settings: ReactNode },
) {
  return (
    <header className="dshb-shell-header" data-window-drag="" data-dshb-shell-header="">
      <div className="dshb-shell-title">
        {props.children}
        {props.sessionTitle !== undefined && (
          <>
            <span className="dshb-shell-sep" aria-hidden="true">
              /
            </span>
            <span
              className="dshb-shell-session"
              title={props.sessionTitle}
              data-dshb-shell-session=""
            >
              {props.sessionTitle}
            </span>
          </>
        )}
      </div>
      {props.settings}
      {props.menuButton}
    </header>
  )
}

export function BotHeader(
  props: Pick<ShellFace, "openSettings"> & HeaderParts & { readonly bot: BotView },
) {
  const { t, bot } = props
  const label = t("shell.settings", { name: bot.name })
  return (
    <HeaderFrame
      {...props}
      settings={
        <button
          type="button"
          className="dshb-shell-button"
          data-dshb-shell-settings=""
          aria-haspopup="dialog"
          aria-label={label}
          title={label}
          onClick={() => props.openSettings(bot.id)}
        >
          <IconSettings size={16} />
        </button>
      }
    >
      <span className="dshb-shell-face">
        <Avatar avatar={bot.avatar} size={24} />
      </span>
      <h1 className="dshb-shell-name" title={bot.name} tabIndex={-1} data-dshb-shell-name="">
        {bot.name}
      </h1>
    </HeaderFrame>
  )
}

export function PendingHeader(props: HeaderParts) {
  const { t } = props
  const label = t("shell.settings.pending")
  return (
    <HeaderFrame
      {...props}
      settings={
        <button
          type="button"
          className="dshb-shell-button"
          data-dshb-shell-settings=""
          aria-haspopup="dialog"
          aria-label={label}
          title={label}
          disabled
        >
          <IconSettings size={16} />
        </button>
      }
    >
      <span className="dshb-shell-face" data-pending="" />
      <h1 className="dshb-shell-name" data-pending="" tabIndex={-1} data-dshb-shell-name="">
        {t("shell.loading")}
      </h1>
    </HeaderFrame>
  )
}
