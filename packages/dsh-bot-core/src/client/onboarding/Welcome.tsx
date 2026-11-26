import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import type { BotChannelDescriptor } from "../../shared/channels"
import { useNow, useObservable } from "../hooks"
import { Spinner } from "../icons"
import { pendingOf } from "../lifecycle"
import { snapshotOf } from "../session-classification"
import { StepConfirm } from "../settings-frame/confirmations"
import type { FrameConfirmation } from "../settings-frame/flow"
import { CreationCard } from "../shell/CreationProgress"
import type { Translate } from "../types"
import { Button } from "../ui"
import { focusHome, useLayer } from "../ui/layers"
import { OnboardingArt } from "./art"
import { BotPage } from "./BotPage"
import { createChannelDrafts } from "./channel-drafts"
import { IntroPage } from "./IntroPage"
import { Actions, type StepProps, type WelcomeSources } from "./parts"
import { AccountsPage, ChannelsPage, WebPage } from "./SetupPages"
import {
  positionOf,
  type SetupAvailability,
  type ShownWelcome,
  type WizardStep,
  wizardSteps,
} from "./steps"

export type { WelcomeSources } from "./parts"

interface Asking {
  readonly request: FrameConfirmation
  answer(confirmed: boolean): void
}

interface GuideProps extends WelcomeSources {
  readonly t: Translate
  readonly welcome: ShownWelcome
  readonly channels: readonly BotChannelDescriptor[]
}

/** The welcome guide over the whole app; only finishing it takes it away. */
export function WelcomeGuide(props: GuideProps) {
  const { t, welcome } = props
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useLayer(ref, { active: true, trap: true, onEscape: () => {} })
  const [asking, setAsking] = useState<Asking | null>(null)
  const confirm = useCallback(
    (request: FrameConfirmation) =>
      new Promise<boolean>((resolve) =>
        setAsking({
          request,
          answer: (confirmed) => {
            setAsking(null)
            resolve(confirmed)
          },
        }),
      ),
    [],
  )
  return (
    <div className="dshb-onboard-root" data-dshb-welcome={welcome.status}>
      <div className="dshb-onboard-mask" aria-hidden="true" />
      <div
        ref={ref}
        className="dshb-onboard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {welcome.status === "creating" ? (
          <CreatingPage {...props} botId={welcome.botId} titleId={titleId} />
        ) : (
          <Wizard {...props} titleId={titleId} confirm={confirm} />
        )}
      </div>
      {asking !== null && <StepConfirm t={t} request={asking.request} onAnswer={asking.answer} />}
    </div>
  )
}

function useAvailability(props: GuideProps): SetupAvailability {
  const web = useObservable(props.web)
  const connections = useObservable(props.connections)
  return {
    web: !(web.status === "ready" && web.view.backend === null),
    accounts: !(connections.status === "ready" && connections.snapshot.providers.length === 0),
    channels: props.channels.length > 0,
  }
}

const PAGES: { readonly [Step in WizardStep]: (props: StepProps) => ReactNode } = {
  welcome: IntroPage,
  web: WebPage,
  accounts: AccountsPage,
  channels: ChannelsPage,
  bot: BotPage,
}

function Wizard(
  props: GuideProps & {
    readonly titleId: string
    confirm(request: FrameConfirmation): Promise<boolean>
  },
) {
  const { t } = props
  const steps = wizardSteps(useAvailability(props))
  const drafts = useMemo(() => createChannelDrafts(props.channelQueries), [props.channelQueries])
  const [at, setAt] = useState<{ readonly step: WizardStep; readonly forward: boolean }>({
    step: "welcome",
    forward: true,
  })
  const index = positionOf(steps, at.step)
  const step = steps[index]
  if (step === undefined) throw new Error("the welcome guide has no page")
  const go = (offset: 1 | -1) => {
    const next = steps[index + offset]
    if (next !== undefined) setAt({ step: next, forward: offset > 0 })
  }
  const Page = PAGES[step]
  return (
    <Frame t={t} step={step} forward={at.forward} steps={steps.length} index={index}>
      <Page
        {...props}
        drafts={drafts}
        next={() => go(1)}
        back={index > 0 ? () => go(-1) : undefined}
      />
    </Frame>
  )
}

/** The picture on one side, the page on the other; a new page slides in from where it comes. */
function Frame(props: {
  readonly t: Translate
  readonly step: WizardStep
  readonly forward: boolean
  readonly steps: number
  readonly index: number
  readonly children: ReactNode
}) {
  const main = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (main.current !== null) focusHome(main.current)
  }, [props.step])
  return (
    <>
      <div className="dshb-onboard-art">
        <div className="dshb-onboard-art-inner" key={props.step}>
          <OnboardingArt kind={props.step} />
        </div>
      </div>
      <div
        ref={main}
        className="dshb-onboard-main"
        key={props.step}
        data-direction={props.forward ? "forward" : "back"}
        data-dshb-welcome-step={props.step}
      >
        {props.children}
        <Dots t={props.t} count={props.steps} index={props.index} />
      </div>
    </>
  )
}

function Dots(props: { readonly t: Translate; readonly count: number; readonly index: number }) {
  return (
    <div
      className="dshb-onboard-dots"
      role="img"
      aria-label={props.t("welcome.position", { at: props.index + 1, count: props.count })}
    >
      {Array.from({ length: props.count }, (_, at) => (
        <span
          key={at}
          className="dshb-onboard-dot"
          data-current={at === props.index ? "" : undefined}
        />
      ))}
    </div>
  )
}

/** The guide's bot being made: the same steps as the main view's, then the bot's Main once it is listed. */
function CreatingPage(props: GuideProps & { readonly botId: string; readonly titleId: string }) {
  const { t, botId } = props
  const snapshot = snapshotOf(useObservable(props.bots))
  const pending = snapshot === undefined ? undefined : pendingOf(snapshot, botId)
  const now = useNow(pending !== undefined && pending.failure === undefined)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <div className="dshb-onboard-art">
        <div className="dshb-onboard-art-inner">
          <OnboardingArt kind="bot" />
        </div>
      </div>
      <div className="dshb-onboard-main" data-dshb-welcome-step="creating" data-bot-id={botId}>
        <div className="dshb-onboard-body dshb-onboard-creating">
          {pending === undefined || pending.operation.kind !== "create" ? (
            <p className="dshb-onboard-status" role="status" id={props.titleId}>
              <Spinner size={14} /> {t("welcome.creating.opening")}
            </p>
          ) : (
            <CreationCard
              t={t}
              bot={pending}
              phase={pending.operation.phase}
              now={now}
              actions={props.pending}
              titleId={props.titleId}
            />
          )}
        </div>
        <Actions>
          <span className="dshb-onboard-spacer" />
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              props.onboarding.finishWelcome().catch(() => setBusy(false))
            }}
            marks={{ "data-dshb-welcome-background": "" }}
          >
            {t("welcome.creating.background")}
          </Button>
        </Actions>
      </div>
    </>
  )
}
