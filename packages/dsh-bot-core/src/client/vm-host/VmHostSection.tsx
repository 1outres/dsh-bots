import { useState } from "react"
import type {
  EnvironmentEgressReportView,
  EnvironmentHostCheck,
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
  COMMITTED,
  Code,
  type CommitResult,
  commitWith,
  EmptyState,
  ErrorText,
  Group,
  type PillTone,
  Row,
  Segmented,
  StatusPill,
  TextFieldRow,
} from "../ui"
import { Command } from "./Command"
import type { VmHostClient } from "./client"
import { ImageGroup } from "./ImageGroup"
import { DEFAULT_PROJECT, projectAllowed, shortFingerprint } from "./model"
import { PairingGroup } from "./PairingGroup"

export interface VmHostSectionDeps {
  readonly host: VmHostClient
}

type Props = GlobalSettingsSectionProps & VmHostSectionDeps

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Where the bots' VMs run: this machine or a paired VM host, its check, isolation and base image. */
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
  const remote = placement.kind === "remote"
  const mode = remote || pairing ? "remote" : "local"
  const projectOf = (current: EnvironmentHostPlacement) =>
    current.kind === "local" || current.kind === "remote" ? current.project : DEFAULT_PROJECT
  return (
    <div className="dshb-settings-groups" data-dshb-vm-host={placement.kind}>
      <Group>
        <Row
          label={t("vmHost.runsOn")}
          trailing={
            <Segmented
              label={t("vmHost.runsOn")}
              value={mode}
              disabled={placement.kind === "reading"}
              choices={[
                { value: "local", label: t("vmHost.local") },
                { value: "remote", label: t("vmHost.remote") },
              ]}
              onChange={(next) => {
                if (next === "remote") {
                  if (!remote) setPairing(true)
                  return
                }
                setPairing(false)
                if (placement.kind !== "remote") return
                run(async () => {
                  const confirmed = await props.confirm({
                    title: t("vmHost.toLocal.title"),
                    description: t("vmHost.toLocal.description", { url: placement.url }),
                    confirm: t("vmHost.toLocal.accept"),
                    tone: "danger",
                  })
                  if (confirmed) await props.host.useLocal(placement.project)
                })
              }}
              marks={{ "data-dshb-vm-host-mode": mode }}
            />
          }
        />
        {!pairing && <PlacementRows {...props} placement={placement} />}
        {remote && !pairing && (
          <>
            <ButtonRow
              label={t("vmHost.pairAnother")}
              onClick={() => setPairing(true)}
              marks={{ "data-dshb-vm-host-pair-another": "" }}
            />
            <ButtonRow
              label={t("vmHost.forget")}
              tone="danger"
              onClick={() =>
                run(async () => {
                  const confirmed = await props.confirm({
                    title: t("vmHost.forget.title", { url: placement.url }),
                    description: t("vmHost.forget.description", { url: placement.url }),
                    confirm: t("vmHost.forget.accept"),
                    tone: "danger",
                  })
                  if (confirmed) await props.host.forget()
                })
              }
              marks={{ "data-dshb-vm-host-forget": "" }}
            />
          </>
        )}
      </Group>
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

/** What belongs to the VM host in use: its check, isolation, left VM hosts and base image. */
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

function PlacementRows(props: Props & { readonly placement: EnvironmentHostPlacement }) {
  const { t, placement } = props
  const project = (current: string) => (
    <ProjectRow
      t={t}
      value={current}
      commit={async (next) => {
        const confirmed = await props.confirm({
          title: t("vmHost.project.title", { project: next }),
          description: t("vmHost.project.description", { current }),
          confirm: t("vmHost.project.accept"),
          tone: "danger",
        })
        return confirmed
          ? commitWith(
              () =>
                placement.kind === "local" && !placement.chosen
                  ? props.host.useLocal(next)
                  : props.host.setProject(next),
              messageOf,
            )
          : "kept"
      }}
    />
  )
  switch (placement.kind) {
    case "reading":
      return <Row label={t("vmHost.reading")} />
    case "unreadable":
      return (
        <Row
          label={t("vmHost.stored")}
          meta={placement.problem.message}
          metaTone="danger"
          marks={{ "data-dshb-vm-host-unreadable": "" }}
        />
      )
    case "local":
      return (
        <>
          <Row label={t("vmHost.socket")} trailing={<Code>{placement.socket}</Code>} />
          {project(placement.project)}
        </>
      )
    case "remote":
      return (
        <>
          <Row
            label={t("vmHost.address")}
            trailing={<Code>{placement.url}</Code>}
            marks={{ "data-dshb-vm-host-url": placement.url }}
          />
          <Row
            label={t("vmHost.serverCertificate")}
            description={placement.serverFingerprint}
            trailing={<Code>{shortFingerprint(placement.serverFingerprint)}</Code>}
          />
          <Row
            label={t("vmHost.clientCertificate")}
            description={placement.clientFingerprint}
            trailing={<Code>{shortFingerprint(placement.clientFingerprint)}</Code>}
          />
          {project(placement.project)}
        </>
      )
  }
}

/** The project field; a change not confirmed puts the field back. */
function ProjectRow(props: {
  readonly t: Translate
  readonly value: string
  commit(project: string): Promise<CommitResult | "kept">
}) {
  const { t } = props
  const [generation, setGeneration] = useState(0)
  return (
    <TextFieldRow
      key={generation}
      label={t("vmHost.project")}
      value={props.value}
      validate={(text) => (projectAllowed(text) ? null : t("vmHost.project.invalid"))}
      commit={async (text) => {
        const result = await props.commit(text.trim())
        if (result !== "kept") return result
        setGeneration((before) => before + 1)
        return COMMITTED
      }}
      marks={{ "data-dshb-vm-host-project": "" }}
    />
  )
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
      {check.state === "ready" && (
        <>
          <Row label={t("check.pool")} trailing={<Code>{check.declaration.pool}</Code>} />
          <Row label={t("check.network")} trailing={<Code>{check.declaration.network}</Code>} />
        </>
      )}
      {check.state === "failed" &&
        check.problems.map((problem, index) => (
          <ProblemRow key={`${problem.code}-${index}`} t={t} problem={problem} />
        ))}
    </Group>
  )
}

function ProblemRow({
  t,
  problem,
}: {
  readonly t: Translate
  readonly problem: EnvironmentHostProblem
}) {
  return (
    <BlockRow
      label={t(`problem.${problem.code}`)}
      meta={problem.message}
      metaTone="danger"
      marks={{ "data-dshb-vm-host-problem": problem.code }}
    >
      <Command t={t} text={problem.fix} />
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
      {check.state === "ready" && (
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
