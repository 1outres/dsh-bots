import type {
  ConnectorPreparationStage,
  ConnectorReadiness,
  ConnectorText,
} from "../shared/connectors"
import { useNow } from "./hooks"
import { elapsedText } from "./lifecycle"
import type { Translate } from "./types"
import { Row, StatusPill } from "./ui"

type Preparing = Extract<ConnectorReadiness, { readonly state: "preparing" }>

export function preparationStageText(t: Translate, stage: ConnectorPreparationStage): string {
  switch (stage.kind) {
    case "requirements":
      return t("connectors.stage.requirements", { connectors: stage.connectors.join(", ") })
    case "queued":
      return t("connectors.stage.queued")
    case "running":
      return stage.step ?? t("connectors.stage.starting")
  }
}

export interface ConnectorPreparingProps {
  readonly t: Translate
  readonly text: (value: ConnectorText) => string
  readonly readiness: Preparing
  readonly hint?: ConnectorText
}

export function ConnectorPreparing({ t, text, readiness, hint }: ConnectorPreparingProps) {
  const now = useNow(true)
  const { stage } = readiness
  const total = elapsedText(now - readiness.since)
  return (
    <Row
      density="compact"
      label={preparationStageText(t, stage)}
      meta={
        stage.since === readiness.since
          ? t("connectors.preparing.elapsed", { time: total })
          : t("connectors.preparing.elapsedStage", {
              time: total,
              stage: elapsedText(now - stage.since),
            })
      }
      trailing={<StatusPill tone="busy" label={t("connectors.state.preparing")} />}
      {...(hint === undefined ? {} : { description: text(hint) })}
      marks={{ "data-dshb-preparing-stage": stage.kind }}
    />
  )
}
