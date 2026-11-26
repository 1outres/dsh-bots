import type { PreflightCheck, SetupInspection } from "../../shared/vm-host-setup"
import type { Translate } from "../types"
import { BlockRow, Button, ButtonRow, Group, type QueryState, Row, StatusPill } from "../ui"
import { Command } from "./Command"
import { checkTone } from "./setup-model"

export function PreflightGroup(props: {
  readonly t: Translate
  readonly inspection: QueryState<SetupInspection>
  onAgain(): void
  readonly onAnotherMachine?: () => void
}) {
  const { t, inspection } = props
  return (
    <Group
      title={t("preflight.title")}
      aside={
        <Button
          variant="row"
          disabled={inspection.status === "loading"}
          onClick={props.onAgain}
          marks={{ "data-dshb-preflight-again": "" }}
        >
          {t("preflight.again")}
        </Button>
      }
      marks={{
        "data-dshb-preflight":
          inspection.status === "ready" ? inspection.value.verdict : inspection.status,
      }}
    >
      {inspection.status === "loading" && (
        <Row
          label={t("preflight.checking")}
          trailing={<StatusPill tone="busy" label={t("preflight.checking")} />}
        />
      )}
      {inspection.status === "failed" && (
        <Row
          label={t("preflight.failed", { message: inspection.message })}
          metaTone="danger"
          trailing={<StatusPill tone="danger" label={t("preflight.state.failed")} />}
        />
      )}
      {inspection.status === "ready" &&
        inspection.value.checks.map((check) => <CheckRow key={check.id} t={t} check={check} />)}
      {inspection.status === "ready" &&
        inspection.value.verdict === "refused" &&
        inspection.value.suggestion === "another-machine" &&
        props.onAnotherMachine !== undefined && (
          <ButtonRow
            label={t("preflight.instead")}
            onClick={props.onAnotherMachine}
            marks={{ "data-dshb-preflight-instead": "" }}
          />
        )}
    </Group>
  )
}

function CheckRow({ t, check }: { readonly t: Translate; readonly check: PreflightCheck }) {
  const label = t(`preflight.check.${check.id}`)
  const pill = <StatusPill tone={checkTone(check)} label={t(`preflight.state.${check.state}`)} />
  const marks = { "data-dshb-preflight-check": check.id, "data-dshb-preflight-state": check.state }
  const meta = check.state === "ok" ? check.value : (check.what ?? check.value)
  if (check.state !== "ok" && check.fix !== undefined) {
    return (
      <BlockRow
        label={label}
        meta={meta}
        metaTone={check.state === "failed" ? "danger" : "warning"}
        trailing={pill}
        marks={marks}
      >
        <Command t={t} text={check.fix} />
      </BlockRow>
    )
  }
  return (
    <Row
      label={label}
      meta={meta}
      metaTone={check.state === "ok" ? undefined : check.state === "failed" ? "danger" : "warning"}
      trailing={pill}
      marks={marks}
    />
  )
}
