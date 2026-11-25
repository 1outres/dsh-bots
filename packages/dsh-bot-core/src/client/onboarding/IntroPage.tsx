import type { MessageKey } from "../i18n"
import { Button } from "../ui"
import { FeatureIcon, type FeatureKind } from "./art"
import { Actions, Heading, type StepProps } from "./parts"

const FEATURES: readonly {
  readonly kind: FeatureKind
  readonly title: MessageKey
  readonly detail: MessageKey
}[] = [
  { kind: "bots", title: "welcome.feature.bots.title", detail: "welcome.feature.bots.detail" },
  { kind: "vm", title: "welcome.feature.vm.title", detail: "welcome.feature.vm.detail" },
  { kind: "main", title: "welcome.feature.main.title", detail: "welcome.feature.main.detail" },
  {
    kind: "google",
    title: "welcome.feature.google.title",
    detail: "welcome.feature.google.detail",
  },
]

/** The welcome: what dsh-bots is, and its main features as cards. */
export function IntroPage(props: StepProps) {
  const { t } = props
  return (
    <>
      <div className="dshb-onboard-body" data-centered="">
        <Heading t={t} titleId={props.titleId} title="welcome.title" lead="welcome.lead" />
        <ul className="dshb-onboard-features">
          {FEATURES.map((feature, at) => (
            <li
              key={feature.kind}
              className="dshb-onboard-feature"
              data-feature={feature.kind}
              style={{ animationDelay: `${120 + at * 70}ms` }}
            >
              <span className="dshb-onboard-feature-icon">
                <FeatureIcon kind={feature.kind} />
              </span>
              <span className="dshb-onboard-feature-text">
                <span className="dshb-onboard-feature-title">{t(feature.title)}</span>
                <span className="dshb-onboard-feature-detail">{t(feature.detail)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Actions>
        <span className="dshb-onboard-spacer" />
        <Button
          variant="primary"
          autoFocus
          onClick={props.next}
          marks={{ "data-dshb-welcome-next": "" }}
        >
          {t("welcome.start")}
        </Button>
      </Actions>
    </>
  )
}
