import type { BotChannelDescriptor } from "../../shared/channels"
import { OAuthClientGroup } from "../global-settings/ConnectionsSettings"
import { useObservable } from "../hooks"
import { IconExternal } from "../icons"
import { ChannelGroup } from "../settings/ChannelsSection"
import { ErrorText, Group, Row } from "../ui"
import { secretsSet } from "../web/model"
import { WebLookupSection } from "../web/WebLookupSection"
import { Actions, BackButton, Heading, SkipOrNext, type StepProps } from "./parts"

/** Where the Exa dashboard hands out API keys. */
export const EXA_API_KEYS = "https://dashboard.exa.ai/api-keys"

/** Web lookup: the same section as the dsh-bots settings'. */
export function WebPage(props: StepProps) {
  const { t } = props
  const state = useObservable(props.web)
  const done = state.status === "ready" && secretsSet(state.view)
  return (
    <>
      <div className="dshb-onboard-body">
        <Heading
          t={t}
          titleId={props.titleId}
          title="welcome.web.title"
          lead="welcome.web.lead"
          eyebrow="welcome.eyebrow.setup"
        />
        <WebLookupSection t={t} confirm={props.confirm} feed={props.web} text={props.text} />
        <a
          className="dshb-onboard-link"
          href={EXA_API_KEYS}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("welcome.web.getKey")}
          <IconExternal size={14} />
        </a>
      </div>
      <Actions>
        <BackButton t={t} back={props.back} />
        <SkipOrNext t={t} done={done} next={props.next} />
      </Actions>
    </>
  )
}

/** Google accounts: each provider's OAuth client, as in the dsh-bots settings. */
export function AccountsPage(props: StepProps) {
  const { t } = props
  const state = useObservable(props.connections)
  const providers = state.status === "ready" ? state.snapshot.providers : []
  const done = providers.length > 0 && providers.every((provider) => provider.client.configured)
  return (
    <>
      <div className="dshb-onboard-body">
        <Heading
          t={t}
          titleId={props.titleId}
          title="welcome.accounts.title"
          lead="welcome.accounts.lead"
          eyebrow="welcome.eyebrow.setup"
        />
        {state.status === "loading" && (
          <Group>
            <Row label={t("connections.loading")} />
          </Group>
        )}
        {state.status === "failed" && (
          <ErrorText>{t("connections.unavailable", { message: state.failure.message })}</ErrorText>
        )}
        {providers.map((provider) => (
          <OAuthClientGroup
            key={provider.id}
            t={t}
            provider={provider}
            connections={props.connections}
          />
        ))}
      </div>
      <Actions>
        <BackButton t={t} back={props.back} />
        <SkipOrNext t={t} done={done} next={props.next} />
      </Actions>
    </>
  )
}

/**
 * Channels (Discord, ...): each channel's steps and the same group as a bot's
 * Channels settings, kept on this page and set up with the bot it creates.
 */
export function ChannelsPage(props: StepProps) {
  const { t, drafts, channels } = props
  useObservable(drafts)
  return (
    <>
      <div className="dshb-onboard-body">
        <Heading
          t={t}
          titleId={props.titleId}
          title="welcome.channels.title"
          lead="welcome.channels.lead"
          eyebrow="welcome.eyebrow.setup"
        />
        {channels.map((channel) => (
          <ChannelSetup key={channel.id} {...props} channel={channel} />
        ))}
      </div>
      <Actions>
        <BackButton t={t} back={props.back} />
        <SkipOrNext
          t={t}
          done={drafts.ready(channels)}
          next={props.next}
          skip={() => drafts.clear()}
        />
      </Actions>
    </>
  )
}

function ChannelSetup(props: StepProps & { readonly channel: BotChannelDescriptor }) {
  const { t, text, channel, drafts } = props
  return (
    <section className="dshb-onboard-channel" data-dshb-welcome-channel={channel.id}>
      {channel.setup !== undefined && (
        <ol className="dshb-onboard-steps">
          {channel.setup.map((step) => (
            <li key={step.en}>{text(step)}</li>
          ))}
        </ol>
      )}
      <ChannelGroup
        t={t}
        text={text}
        view={drafts.view(channel)}
        configure={(_channelId, change) => drafts.configure(channel, change)}
        ask={drafts.ask(channel)}
      />
    </section>
  )
}
