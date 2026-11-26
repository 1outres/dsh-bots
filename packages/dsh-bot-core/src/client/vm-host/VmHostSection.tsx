import { useState } from "react"
import type {
  BackendPlacementView,
  EnvironmentEgressReportView,
  EnvironmentHostCheck,
  EnvironmentHostDeclaration,
  EnvironmentHostPlacement,
  EnvironmentHostProblem,
  EnvironmentHostSettingsView,
} from "../../shared/environment-host"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { useObservable } from "../hooks"
import { IconServer } from "../icons"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import {
  BlockRow,
  Button,
  ButtonRow,
  Code,
  EmptyState,
  ErrorText,
  Group,
  type PillTone,
  Row,
  StatusPill,
  Tag,
} from "../ui"
import { Command } from "./Command"
import type { VmHostClient } from "./client"
import { ImageGroup } from "./ImageGroup"
import { DEFAULT_PROJECT, fixShown, shortFingerprint } from "./model"
import { PairingGroup } from "./PairingGroup"

export interface VmHostSectionDeps {
  readonly host: VmHostClient
}

type Props = GlobalSettingsSectionProps & VmHostSectionDeps

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export function VmHostSection(props: Props) {
  const { t, host } = props
  const state = useObservable(host)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("vmHost.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("vmHost.unavailable", { message: state.message })}</ErrorText>
  }
  if (state.value.status === "none") {
    return <EmptyState icon={<IconServer size={28} />} title={t("vmHost.none")} />
  }
  return <VmHostBody {...props} view={state.value.host} />
}

function VmHostBody(props: Props & { readonly view: EnvironmentHostSettingsView }) {
  const { t, view } = props
  const [pairing, setPairing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = (work: () => Promise<unknown>) => {
    setFailure(null)
    void work().catch((cause: unknown) => setFailure(messageOf(cause)))
  }
  const placement = view.placement
  return (
    <div className="dshb-settings-groups" data-dshb-vm-host={placement.kind}>
      {!pairing && (
        <Group>
          <PlacementRows t={t} placement={placement} />
          {placement.kind !== "reading" && (
            <ButtonRow
              label={placement.kind === "placed" ? t("vmHost.pairAnother") : t("vmHost.pair")}
              onClick={() => setPairing(true)}
              marks={{ "data-dshb-vm-host-pair-another": "" }}
            />
          )}
          {placement.kind === "placed" && (
            <ButtonRow
              label={t("vmHost.forget")}
              tone="danger"
              onClick={() =>
                run(async () => {
                  const url = placement.backend.url
                  const confirmed = await props.confirm({
                    title: t("vmHost.forget.title", { url }),
                    description: t("vmHost.forget.description", { url }),
                    confirm: t("vmHost.forget.accept"),
                    tone: "danger",
                  })
                  if (confirmed) await props.host.forget()
                })
              }
              marks={{ "data-dshb-vm-host-forget": "" }}
            />
          )}
        </Group>
      )}
      {pairing && (
        <PairingGroup
          t={t}
          host={props.host}
          confirm={props.confirm}
          project={projectOf(placement)}
          onDone={() => setPairing(false)}
        />
      )}
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      {!pairing && <PlacedGroups {...props} view={view} run={run} onFailure={setFailure} />}
    </div>
  )
}

function projectOf(placement: EnvironmentHostPlacement): string {
  switch (placement.kind) {
    case "migration-required":
      return placement.from.project
    case "placed":
      return placement.backend.kind === "incus" ? placement.backend.project : DEFAULT_PROJECT
    default:
      return DEFAULT_PROJECT
  }
}

function PlacedGroups(
  props: Props & {
    readonly view: EnvironmentHostSettingsView
    run(work: () => Promise<unknown>): void
    onFailure(message: string): void
  },
) {
  const { t, view } = props
  return (
    <>
      <CheckGroup t={t} check={view.check} onCheck={() => props.run(() => props.host.check())} />
      <EgressGroup t={t} check={view.check} reports={view.egress} />
      {view.released.length > 0 && (
        <Group title={t("released.title")} marks={{ "data-dshb-vm-host-released": "" }}>
          {view.released.map((release) => (
            <BlockRow
              key={release.clientFingerprint}
              label={t("released.row", { url: release.url })}
            >
              <Command t={t} text={release.command} />
            </BlockRow>
          ))}
        </Group>
      )}
      {view.image !== undefined && (
        <ImageGroup t={t} image={view.image} host={props.host} onFailure={props.onFailure} />
      )}
    </>
  )
}

function PlacementRows(props: {
  readonly t: Translate
  readonly placement: EnvironmentHostPlacement
}) {
  const { t, placement } = props
  switch (placement.kind) {
    case "reading":
      return <Row label={t("vmHost.reading")} />
    case "none":
      return (
        <Row
          label={t("vmHost.runsOn")}
          trailing={<StatusPill tone="danger" label={t("vmHost.unchosen")} />}
          marks={{ "data-dshb-vm-host-none": "" }}
        />
      )
    case "unreadable":
      return (
        <Row
          label={t("vmHost.stored")}
          meta={placement.problem.message}
          metaTone="danger"
          marks={{ "data-dshb-vm-host-unreadable": "" }}
        />
      )
    case "migration-required":
      return (
        <>
          <Row
            label={t("vmHost.move")}
            trailing={<StatusPill tone="warning" label={t("vmHost.move.needed")} />}
            marks={{ "data-dshb-vm-host-move": "" }}
          />
          <Row label={t("vmHost.socket")} trailing={<Code>{placement.from.socket}</Code>} />
          <Row label={t("vmHost.project")} trailing={<Code>{placement.from.project}</Code>} />
        </>
      )
    case "placed":
      return (
        <>
          <Row
            label={t("vmHost.runsOn")}
            trailing={
              <span className="dshb-vm-host-tags">
                <Tag marks={{ "data-dshb-vm-host-origin": placement.origin.kind }}>
                  {t(`vmHost.origin.${placement.origin.kind}`)}
                </Tag>
                <Tag marks={{ "data-dshb-vm-host-backend": placement.backend.kind }}>
                  {t(`vmHost.backend.${placement.backend.kind}`)}
                </Tag>
              </span>
            }
          />
          <BackendRows t={t} backend={placement.backend} />
        </>
      )
  }
}

function BackendRows(props: { readonly t: Translate; readonly backend: BackendPlacementView }) {
  const { t, backend } = props
  const address = (
    <Row
      label={t("vmHost.address")}
      trailing={<Code>{backend.url}</Code>}
      marks={{ "data-dshb-vm-host-url": backend.url }}
    />
  )
  const server = (
    <Row
      label={t("vmHost.serverCertificate")}
      description={backend.serverFingerprint}
      trailing={<Code>{shortFingerprint(backend.serverFingerprint)}</Code>}
    />
  )
  switch (backend.kind) {
    case "incus":
      return (
        <>
          {address}
          {server}
          <Row
            label={t("vmHost.clientCertificate")}
            description={backend.clientFingerprint}
            trailing={<Code>{shortFingerprint(backend.clientFingerprint)}</Code>}
          />
          <Row
            label={t("vmHost.project")}
            trailing={<Code>{backend.project}</Code>}
            marks={{ "data-dshb-vm-host-project": backend.project }}
          />
        </>
      )
    case "proxmox":
      return (
        <>
          {address}
          {server}
          <Row label={t("vmHost.node")} trailing={<Code>{backend.node}</Code>} />
          <Row label={t("vmHost.pool")} trailing={<Code>{backend.pool}</Code>} />
          <Row label={t("vmHost.tokenId")} trailing={<Code>{backend.tokenId}</Code>} />
        </>
      )
  }
}

function checkPill(t: Translate, check: EnvironmentHostCheck): { tone: PillTone; label: string } {
  const format = localeFormat(t)
  switch (check.state) {
    case "unchecked":
      return { tone: "idle", label: t("check.unchecked") }
    case "checking":
      return { tone: "busy", label: t("check.checking") }
    case "ready":
      return { tone: "success", label: t("check.ready") }
    case "failed":
      return { tone: "danger", label: format.count("check.failed", check.problems.length) }
  }
}

function CheckGroup(props: {
  readonly t: Translate
  readonly check: EnvironmentHostCheck
  onCheck(): void
}) {
  const { t, check } = props
  const pill = checkPill(t, check)
  const format = localeFormat(t)
  return (
    <Group
      title={t("check.title")}
      aside={
        <Button
          variant="row"
          disabled={check.state === "checking"}
          onClick={props.onCheck}
          marks={{ "data-dshb-vm-host-check": "" }}
        >
          {t("check.again")}
        </Button>
      }
      marks={{ "data-dshb-vm-host-check-state": check.state }}
    >
      <Row
        label={t("check.state")}
        meta={
          check.state === "ready" || check.state === "failed"
            ? t("check.at", { time: format.instant(check.at, "dateTime") })
            : undefined
        }
        trailing={<StatusPill tone={pill.tone} label={pill.label} />}
      />
      {check.state === "ready" && <DeclarationRows t={t} declaration={check.declaration} />}
      {check.state === "failed" &&
        check.problems.map((problem, index) => (
          <ProblemRow key={`${problem.code}-${index}`} t={t} problem={problem} />
        ))}
    </Group>
  )
}

function DeclarationRows(props: {
  readonly t: Translate
  readonly declaration: EnvironmentHostDeclaration
}) {
  const { t, declaration } = props
  switch (declaration.kind) {
    case "incus":
      return (
        <>
          <Row label={t("check.pool")} trailing={<Code>{declaration.pool}</Code>} />
          <Row label={t("check.network")} trailing={<Code>{declaration.network}</Code>} />
        </>
      )
    case "proxmox":
      return (
        <>
          <Row label={t("vmHost.node")} trailing={<Code>{declaration.node}</Code>} />
          <Row label={t("vmHost.pool")} trailing={<Code>{declaration.pool}</Code>} />
        </>
      )
  }
}

function ProblemRow({
  t,
  problem,
}: {
  readonly t: Translate
  readonly problem: EnvironmentHostProblem
}) {
  const fix = fixShown(problem.fix)
  return (
    <BlockRow
      label={t(`problem.${problem.scope}.${problem.code}`)}
      meta={problem.message}
      metaTone="danger"
      marks={{ "data-dshb-vm-host-problem": problem.code }}
    >
      {fix.kind === "command" ? (
        <Command t={t} text={fix.text} />
      ) : (
        <span className="dshb-vm-host-fix">{fix.kind === "text" ? fix.text : t(fix.key)}</span>
      )}
    </BlockRow>
  )
}

function egressPill(t: Translate, report: EnvironmentEgressReportView) {
  const format = localeFormat(t)
  switch (report.measure.state) {
    case "isolated":
      return { tone: "success" as const, label: t("egress.isolated"), meta: undefined }
    case "open":
      return {
        tone: "warning" as const,
        label: format.count("egress.open", report.measure.reached.length),
        meta: report.measure.reached.join(", "),
      }
    case "unmeasured":
      return { tone: "idle" as const, label: t("egress.unmeasured"), meta: report.measure.reason }
  }
}

function EgressGroup(props: {
  readonly t: Translate
  readonly check: EnvironmentHostCheck
  readonly reports: readonly EnvironmentEgressReportView[]
}) {
  const { t, check, reports } = props
  return (
    <Group title={t("egress.title")} marks={{ "data-dshb-vm-host-egress": "" }}>
      {check.state === "ready" && check.declaration.kind === "incus" && (
        <Row
          label={t("egress.acl")}
          trailing={
            check.declaration.egressAcl === undefined ? (
              <StatusPill tone="warning" label={t("egress.acl.undeclared")} />
            ) : (
              <Code>{check.declaration.egressAcl}</Code>
            )
          }
          marks={{ "data-dshb-vm-host-acl": check.declaration.egressAcl ?? "" }}
        />
      )}
      {reports.length === 0 && <Row label={t("egress.none")} />}
      {reports.map((report) => {
        const pill = egressPill(t, report)
        return (
          <Row
            key={report.botId}
            label={report.botName}
            meta={pill.meta}
            metaTone={report.measure.state === "open" ? "warning" : undefined}
            trailing={<StatusPill tone={pill.tone} label={pill.label} />}
            marks={{ "data-dshb-vm-host-egress-bot": report.measure.state }}
          />
        )
      })}
    </Group>
  )
}
