import { useState } from "react"
import type {
  BackendPlacementView,
  BotEnvironmentHostState,
  EnvironmentEgressReportView,
  EnvironmentHostCheck,
  EnvironmentHostDeclaration,
  EnvironmentHostPlacement,
  EnvironmentHostProblem,
  EnvironmentHostSettingsView,
  HostOriginView,
} from "../../shared/environment-host"
import type { HostSiteView } from "../../shared/vm-host-setup"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { useObservable } from "../hooks"
import { IconServer } from "../icons"
import { localeFormat } from "../locale-format"
import { messageOf } from "../remote-feed"
import type { Translate } from "../types"
import {
  BlockRow,
  Button,
  ButtonRow,
  Code,
  EmptyState,
  ErrorText,
  Group,
  NavRow,
  PageTitle,
  type PillTone,
  Row,
  StatusPill,
  Tag,
} from "../ui"
import { BuildPage } from "./BuildPage"
import { Command } from "./Command"
import type { VmHostClient } from "./client"
import { ExistingServerPage } from "./ExistingServerPage"
import { ImageGroup } from "./ImageGroup"
import { DEFAULT_PROJECT, fixShown, shortFingerprint } from "./model"
import { type SetupPage, setupPageOf } from "./pages"
import { SetupJobGroup } from "./SetupJobGroup"
import { SetupLogPage } from "./SetupLogPage"
import {
  addressText,
  type BuildIntent,
  jobEnded,
  repairIntent,
  retryIntent,
  serverLabelOf,
} from "./setup-model"

export interface VmHostSectionDeps {
  readonly host: VmHostClient
  openSession(sessionId: string): void
}

type Props = GlobalSettingsSectionProps & VmHostSectionDeps

type Ready = Extract<BotEnvironmentHostState, { readonly status: "ready" }>

type BodyProps = Props & { readonly state: Ready }

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
  return <VmHostPages {...props} state={state.value} />
}

function VmHostPages(props: BodyProps) {
  const { t, page, state } = props
  const view = state.host
  const shown = setupPageOf(page.detail)
  const open = (next: SetupPage) => page.open(next)
  const build = (intent: BuildIntent, title: string) => (
    <BuildPage
      key={page.detail ?? ""}
      t={t}
      host={props.host}
      intent={intent}
      title={title}
      placement={view.placement}
      confirm={props.confirm}
      onDone={() => page.back()}
      onAnotherMachine={() => open("another-machine")}
    />
  )
  switch (shown) {
    case "choose":
      return (
        <div className="dshb-settings-groups">
          <PageTitle>{t("setup.page.choose")}</PageTitle>
          <ChooseGroup t={t} onOpen={open} />
        </div>
      )
    case "this-machine":
      return build({ kind: "new", site: "this-machine" }, t("setup.choice.this-machine"))
    case "another-machine":
      return build({ kind: "new", site: "ssh" }, t("setup.choice.another-machine"))
    case "existing":
      return (
        <ExistingServerPage
          t={t}
          host={props.host}
          confirm={props.confirm}
          project={projectOf(view.placement)}
          pluginVersion={state.pluginVersion}
          onDone={() => page.back()}
        />
      )
    case "move":
      if (view.placement.kind !== "migration-required") break
      return build({ kind: "move", project: view.placement.from.project }, t("setup.page.move"))
    case "repair": {
      const intent = repairIntent(view.placement)
      if (intent === null) break
      return build(intent, t("setup.page.repair"))
    }
    case "retry":
      if (view.setup === undefined) break
      return build(retryIntent(view.setup, view.placement), t("setup.page.retry"))
    case "log":
      if (view.setup === undefined) break
      return <SetupLogPage t={t} job={view.setup} />
    case null:
      break
  }
  return <VmHostBody {...props} view={view} open={open} />
}

function VmHostBody(
  props: BodyProps & {
    readonly view: EnvironmentHostSettingsView
    open(page: SetupPage): void
  },
) {
  const { t, view, open } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = (work: () => Promise<unknown>) => {
    setFailure(null)
    setBusy(true)
    void work()
      .catch((cause: unknown) => setFailure(messageOf(cause)))
      .finally(() => setBusy(false))
  }
  const job = view.setup
  const building = job !== undefined && !jobEnded(job)
  const placement = view.placement
  return (
    <div className="dshb-settings-groups" data-dshb-vm-host={placement.kind}>
      {job !== undefined && (
        <SetupJobGroup
          t={t}
          job={job}
          busy={busy}
          actions={{
            cancel: () => run(() => props.host.cancelSetup(job.id)),
            retry: () => open("retry"),
            dismiss: () => run(() => props.host.dismissSetup(job.id)),
            openLog: () => open("log"),
            investigate: () =>
              run(async () => {
                const { sessionId } = await props.host.investigateSetup(job.id)
                props.close()
                props.openSession(sessionId)
              }),
          }}
        />
      )}
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      {placement.kind === "reading" && (
        <Group>
          <Row label={t("vmHost.reading")} />
        </Group>
      )}
      {placement.kind === "unreadable" && (
        <Group>
          <Row
            label={t("vmHost.stored")}
            meta={placement.problem.message}
            metaTone="danger"
            marks={{ "data-dshb-vm-host-unreadable": "" }}
          />
        </Group>
      )}
      {(placement.kind === "none" || placement.kind === "unreadable") && !building && (
        <ChooseGroup t={t} onOpen={open} />
      )}
      {placement.kind === "migration-required" && (
        <MoveGroup t={t} placement={placement} building={building} open={open} />
      )}
      {placement.kind === "placed" && (
        <PlacedGroups
          {...props}
          placement={placement}
          building={building}
          busy={busy}
          run={run}
          onFailure={setFailure}
        />
      )}
    </div>
  )
}

function ChooseGroup(props: { readonly t: Translate; onOpen(page: SetupPage): void }) {
  const { t } = props
  const choices = [
    { page: "this-machine", backend: t("vmHost.backend.incus") },
    { page: "another-machine", backend: t("vmHost.backend.incus") },
    { page: "existing", backend: t("setup.backend.any") },
  ] as const
  return (
    <Group title={t("setup.choose.title")} marks={{ "data-dshb-vm-host-choices": "" }}>
      {choices.map((choice) => (
        <NavRow
          key={choice.page}
          label={t(`setup.choice.${choice.page}`)}
          trailing={<Tag>{choice.backend}</Tag>}
          onOpen={() => props.onOpen(choice.page)}
          marks={{ "data-dshb-vm-host-choice": choice.page }}
        />
      ))}
    </Group>
  )
}

function MoveGroup(props: {
  readonly t: Translate
  readonly placement: Extract<EnvironmentHostPlacement, { readonly kind: "migration-required" }>
  readonly building: boolean
  open(page: SetupPage): void
}) {
  const { t, placement } = props
  return (
    <Group
      title={t("vmHost.move")}
      tag={<StatusPill tone="warning" label={t("vmHost.move.needed")} />}
      marks={{ "data-dshb-vm-host-move": "" }}
    >
      <Row label={t("vmHost.socket")} trailing={<Code>{placement.from.socket}</Code>} />
      <Row label={t("vmHost.project")} trailing={<Code>{placement.from.project}</Code>} />
      <ButtonRow
        label={t("vmHost.move.start")}
        disabled={props.building}
        onClick={() => props.open("move")}
        marks={{ "data-dshb-vm-host-move-start": "" }}
      />
      <ButtonRow
        label={t("vmHost.another")}
        disabled={props.building}
        onClick={() => props.open("choose")}
      />
    </Group>
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

function whereOf(t: Translate, backend: BackendPlacementView, origin: HostOriginView): string {
  if (origin.kind === "custom") return serverLabelOf(backend)
  return siteText(t, origin.site)
}

function siteText(t: Translate, site: HostSiteView): string {
  return site.kind === "this-machine" ? t("setup.site.this-machine") : addressText(site)
}

function PlacedGroups(
  props: BodyProps & {
    readonly view: EnvironmentHostSettingsView
    readonly placement: Extract<EnvironmentHostPlacement, { readonly kind: "placed" }>
    readonly building: boolean
    readonly busy: boolean
    open(page: SetupPage): void
    run(work: () => Promise<unknown>): void
    onFailure(message: string): void
  },
) {
  const { t, view, placement } = props
  const origin = placement.origin
  const repair =
    origin.kind === "managed" && !props.building ? () => props.open("repair") : undefined
  return (
    <>
      <Group marks={{ "data-dshb-vm-host-in-use": origin.kind }}>
        <Row
          label={t("vmHost.runsOn")}
          meta={whereOf(t, placement.backend, origin)}
          trailing={
            <span className="dshb-vm-host-tags">
              <Tag marks={{ "data-dshb-vm-host-origin": origin.kind }}>
                {t(`vmHost.origin.${origin.kind}`)}
              </Tag>
              <Tag marks={{ "data-dshb-vm-host-backend": placement.backend.kind }}>
                {t(`vmHost.backend.${placement.backend.kind}`)}
              </Tag>
            </span>
          }
        />
        <BackendRows t={t} backend={placement.backend} />
        {origin.kind === "managed" && (
          <Row
            label={t("vmHost.repair")}
            trailing={
              <>
                {origin.update === "available" && (
                  <StatusPill tone="warning" label={t("vmHost.update")} />
                )}
                <Button
                  variant="row"
                  disabled={repair === undefined}
                  onClick={() => repair?.()}
                  marks={{ "data-dshb-vm-host-repair-row": origin.update }}
                >
                  {t("vmHost.repair.run")}
                </Button>
              </>
            }
          />
        )}
        {origin.kind === "managed" && origin.site.kind === "ssh" && (
          <SshKeyRow {...props} site={origin.site} />
        )}
        <ButtonRow
          label={t("vmHost.another")}
          disabled={props.building}
          onClick={() => props.open("choose")}
          marks={{ "data-dshb-vm-host-pair-another": "" }}
        />
        <ButtonRow
          label={t("vmHost.forget")}
          tone="danger"
          disabled={props.building}
          onClick={() =>
            props.run(async () => {
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
      </Group>
      <CheckGroup
        t={t}
        check={view.check}
        onCheck={() => props.run(() => props.host.check())}
        onRepair={repair}
      />
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

function SshKeyRow(
  props: BodyProps & {
    readonly site: Extract<HostSiteView, { readonly kind: "ssh" }>
    readonly building: boolean
  },
) {
  const { t, site } = props
  const [refused, setRefused] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const remove = async (scope: "remote-and-local" | "local") => {
    const base = scope === "local" ? "vmHost.sshKey.removeLocal" : "vmHost.sshKey.remove"
    const confirmed = await props.confirm({
      title: t(`${base}.title`),
      description: t(`${base}.description`, { host: site.host }),
      confirm: t("vmHost.sshKey.remove.accept"),
      tone: "danger",
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await props.host.removeSetupIdentity(scope)
      setRefused(null)
    } catch (cause) {
      setRefused(t("vmHost.sshKey.failed", { message: messageOf(cause) }))
    } finally {
      setBusy(false)
    }
  }
  const kept = site.identity === "kept"
  return (
    <Row
      label={t("vmHost.sshKey")}
      meta={refused ?? undefined}
      metaTone={refused === null ? undefined : "danger"}
      trailing={
        <>
          <StatusPill
            tone={kept ? "success" : "idle"}
            label={t(kept ? "vmHost.sshKey.kept" : "vmHost.sshKey.removed")}
          />
          {kept && (
            <Button
              variant="row"
              disabled={busy || props.building}
              onClick={() => void remove(refused === null ? "remote-and-local" : "local")}
              marks={{ "data-dshb-vm-host-ssh-key-remove": refused === null ? "both" : "local" }}
            >
              {t(refused === null ? "vmHost.sshKey.remove" : "vmHost.sshKey.removeLocal")}
            </Button>
          )}
        </>
      }
      marks={{ "data-dshb-vm-host-ssh-key": site.identity }}
    />
  )
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
  readonly onRepair?: () => void
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
          <ProblemRow
            key={`${problem.code}-${index}`}
            t={t}
            problem={problem}
            onRepair={props.onRepair}
          />
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
  onRepair,
}: {
  readonly t: Translate
  readonly problem: EnvironmentHostProblem
  readonly onRepair?: () => void
}) {
  const fix = fixShown(problem.fix)
  if (problem.fix.kind === "repair" && onRepair !== undefined) {
    return (
      <Row
        label={t(`problem.${problem.scope}.${problem.code}`)}
        meta={problem.message}
        metaTone="danger"
        trailing={
          <Button variant="row" onClick={onRepair} marks={{ "data-dshb-vm-host-repair": "" }}>
            {t("vmHost.repair.run")}
          </Button>
        }
        marks={{ "data-dshb-vm-host-problem": problem.code }}
      />
    )
  }
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
