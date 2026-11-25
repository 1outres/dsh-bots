import type { ReactNode } from "react"
import type { BotChannelDescriptor } from "../../shared/channels"
import type { ConnectionsFeed } from "../connections-model"
import type { CreationSources } from "../creation/use-creation-form"
import type { PendingActions } from "../face"
import type { MessageKey } from "../i18n"
import type { Observable } from "../observable"
import type { BotsState } from "../session-classification"
import type { FrameConfirmation } from "../settings-frame/flow"
import type { Translate } from "../types"
import { Button } from "../ui"
import type { WebLookupFeed } from "../web/feed"
import type { ChannelDrafts } from "./channel-drafts"
import type { OnboardingClient } from "./client"

/** Where the guide reads and changes what it shows. */
export interface WelcomeSources {
  readonly onboarding: Pick<OnboardingClient, "createBot" | "finishWelcome">
  readonly bots: Observable<BotsState>
  readonly pending: PendingActions
  readonly creation: CreationSources
  readonly web: WebLookupFeed
  readonly connections: ConnectionsFeed
  /** A plugin's text (a web backend's, a channel's) in the active language. */
  text(text: { readonly en: string; readonly ja?: string }): string
}

/** What every page of the guide is given. */
export interface StepProps extends WelcomeSources {
  readonly t: Translate
  readonly titleId: string
  /** The channels the guide can set up, as the Host offers them. */
  readonly channels: readonly BotChannelDescriptor[]
  /** This page's channel settings typed before the bot exists. */
  readonly drafts: ChannelDrafts
  next(): void
  readonly back: (() => void) | undefined
  confirm(request: FrameConfirmation): Promise<boolean>
}

export function Heading(props: {
  readonly t: Translate
  readonly titleId: string
  readonly title: MessageKey
  readonly lead: MessageKey
  readonly eyebrow?: MessageKey
}) {
  const { t } = props
  return (
    <header className="dshb-onboard-heading">
      {props.eyebrow !== undefined && <p className="dshb-onboard-eyebrow">{t(props.eyebrow)}</p>}
      <h2 className="dshb-onboard-title" id={props.titleId}>
        {t(props.title)}
      </h2>
      <p className="dshb-onboard-lead">{t(props.lead)}</p>
    </header>
  )
}

export function Actions({ children }: { readonly children: ReactNode }) {
  return <div className="dshb-onboard-actions">{children}</div>
}

export function BackButton(props: {
  readonly t: Translate
  readonly back: (() => void) | undefined
}) {
  if (props.back === undefined) return <span className="dshb-onboard-spacer" />
  return (
    <Button variant="secondary" onClick={props.back} marks={{ "data-dshb-welcome-back": "" }}>
      {props.t("welcome.back")}
    </Button>
  )
}

/** Next once the page's setting is made, else Skip (which runs `skip` first). */
export function SkipOrNext(props: {
  readonly t: Translate
  readonly done: boolean
  next(): void
  skip?(): void
}) {
  const { t } = props
  return props.done ? (
    <Button variant="primary" onClick={props.next} marks={{ "data-dshb-welcome-next": "" }}>
      {t("welcome.next")}
    </Button>
  ) : (
    <Button
      variant="secondary"
      onClick={() => {
        props.skip?.()
        props.next()
      }}
      marks={{ "data-dshb-welcome-skip": "" }}
    >
      {t("welcome.skip")}
    </Button>
  )
}
