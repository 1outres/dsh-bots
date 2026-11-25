import { useId, useState } from "react"
import { BotCreationFields } from "../creation/BotCreationFields"
import { useBotCreationForm } from "../creation/use-creation-form"
import { Spinner } from "../icons"
import { Button, ErrorText, Group, Row, StatusPill } from "../ui"
import { Actions, BackButton, Heading, type StepProps } from "./parts"

/** The first bot: the New bot dialog's fields, created with the channels set up on this page. */
export function BotPage(props: StepProps) {
  const { t, drafts, channels } = props
  const form = useBotCreationForm(t, props.creation)
  const formId = useId()
  const [finishing, setFinishing] = useState<{ readonly busy: boolean; readonly error?: string }>({
    busy: false,
  })
  const setups = drafts.setups(channels)
  const later = async () => {
    setFinishing({ busy: true })
    try {
      await props.onboarding.finishWelcome()
    } catch (cause) {
      setFinishing({ busy: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }
  const unavailable =
    form.environment?.status === "unavailable" ? form.environment.reason : undefined
  const laterButton = (variant: "primary" | "secondary") => (
    <Button
      variant={variant}
      disabled={finishing.busy || form.busy}
      onClick={() => void later()}
      marks={{ "data-dshb-welcome-later": "" }}
    >
      {t("welcome.later")}
    </Button>
  )
  const finishingError = finishing.error !== undefined && (
    <ErrorText>{t("error.generic", { message: finishing.error })}</ErrorText>
  )
  if (unavailable !== undefined) {
    return (
      <>
        <div className="dshb-onboard-body" data-dshb-welcome-no-environment="">
          <Heading
            t={t}
            titleId={props.titleId}
            title="welcome.noEnvironment.title"
            lead="welcome.noEnvironment.lead"
            eyebrow="welcome.eyebrow.bot"
          />
          <ErrorText>{unavailable}</ErrorText>
          {finishingError}
        </div>
        <Actions>
          <BackButton t={t} back={props.back} />
          <Button
            variant="secondary"
            onClick={form.reloadOffer}
            marks={{ "data-dshb-welcome-recheck": "" }}
          >
            {t("welcome.noEnvironment.recheck")}
          </Button>
          {laterButton("primary")}
        </Actions>
      </>
    )
  }
  return (
    <>
      <form
        className="dshb-onboard-body dshb-create"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          void form.submit(async (request) => {
            await props.onboarding.createBot(request, setups)
            drafts.clear()
          })
        }}
      >
        <Heading
          t={t}
          titleId={props.titleId}
          title="welcome.bot.title"
          lead="welcome.bot.lead"
          eyebrow="welcome.eyebrow.bot"
        />
        {form.offer.status === "loading" ? (
          <p className="dshb-onboard-status" role="status">
            <Spinner size={14} /> {t("welcome.bot.loading")}
          </p>
        ) : (
          <BotCreationFields t={t} form={form} autoFocus />
        )}
        {setups.length > 0 && (
          <Group title={t("welcome.bot.channels")}>
            {setups.map((setup) => {
              const channel = channels.find((offered) => offered.id === setup.channelId)
              return (
                <Row
                  key={setup.channelId}
                  label={channel?.name ?? setup.channelId}
                  marks={{ "data-dshb-welcome-channel-setup": setup.channelId }}
                  trailing={<StatusPill tone="idle" label={t("welcome.bot.channelAfter")} />}
                />
              )
            })}
          </Group>
        )}
        {finishingError}
      </form>
      <Actions>
        <BackButton t={t} back={props.back} />
        {laterButton("secondary")}
        <Button
          variant="primary"
          type="submit"
          form={formId}
          disabled={form.blocked}
          marks={{ "data-dshb-welcome-create": "" }}
        >
          {form.busy ? t("form.creating") : t("form.create")}
        </Button>
      </Actions>
    </>
  )
}
