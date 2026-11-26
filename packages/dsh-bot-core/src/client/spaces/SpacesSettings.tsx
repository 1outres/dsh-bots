import { useState } from "react"
import { type BotSpacesSettings, parsePublicBaseUrl } from "../../shared/spaces"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { useObservable } from "../hooks"
import type { Observable } from "../observable"
import { Button } from "../ui/Button"
import { commitWith } from "../ui/commit"
import { ErrorText } from "../ui/EmptyState"
import { Group } from "../ui/Group"
import { Row } from "../ui/Row"
import { StatusPill } from "../ui/StatusPill"
import { TextField } from "../ui/TextField"
import { useTextDraft } from "../ui/text-draft"
import { spaceErrorText } from "./failure-text"
import { type SpacesState, spacesViewOf } from "./feed"

export interface SpacesSettingsDeps {
  readonly feed: Observable<SpacesState>
  setPublicBaseUrl(url: string | null): Promise<BotSpacesSettings>
}

export function SpacesSettings(props: GlobalSettingsSectionProps & SpacesSettingsDeps) {
  const { t } = props
  const state = useObservable(props.feed)
  const view = spacesViewOf(state)
  if (state.status === "loading") return <p className="dshb-note">{t("spaces.loading")}</p>
  if (view === undefined) {
    return (
      <ErrorText>
        {t("spaces.unavailable", { message: "message" in state ? state.message : "" })}
      </ErrorText>
    )
  }
  return (
    <Group marks={{ "data-dshb-spaces-global": "" }}>
      <BaseUrlRow {...props} saved={view.settings.publicBaseUrl} />
    </Group>
  )
}

function BaseUrlRow(
  props: GlobalSettingsSectionProps & SpacesSettingsDeps & { readonly saved: string | null },
) {
  const { t, saved } = props
  const [useError, setUseError] = useState<string | null>(null)
  const suggested = spacesViewOf(useObservable(props.feed))?.settings.suggestedBaseUrl ?? null
  const draft = useTextDraft({
    value: saved ?? "",
    validate: (text) =>
      text.trim() === "" || parsePublicBaseUrl(text).ok ? null : t("spaces.baseUrl.invalid"),
    commit: (text) =>
      commitWith(
        () => props.setPublicBaseUrl(text.trim() === "" ? null : text),
        (cause) => spaceErrorText(t, cause),
      ),
  })
  const offerSuggestion = suggested !== null && suggested !== saved
  return (
    <Row
      label={t("spaces.baseUrl")}
      meta={draft.error ?? useError ?? (offerSuggestion ? suggested : undefined)}
      metaTone={draft.error === null && useError === null ? undefined : "danger"}
      marks={{ "data-dshb-spaces-base-url": saved === null ? "off" : "on" }}
      trailing={
        <>
          {saved === null && <StatusPill tone="warning" label={t("spaces.baseUrl.off")} />}
          {offerSuggestion && (
            <Button
              variant="row"
              disabled={draft.busy}
              onClick={() => {
                setUseError(null)
                props.setPublicBaseUrl(suggested).then(
                  () => setUseError(null),
                  (cause: unknown) => setUseError(spaceErrorText(t, cause)),
                )
              }}
              marks={{ "data-dshb-spaces-base-url-use": "" }}
            >
              {t("spaces.baseUrl.use")}
            </Button>
          )}
          <TextField
            draft={draft}
            label={t("spaces.baseUrl")}
            type="url"
            placeholder="https://"
            width="fill"
            marks={{ "data-dshb-spaces-base-url-field": "" }}
          />
        </>
      }
    />
  )
}
