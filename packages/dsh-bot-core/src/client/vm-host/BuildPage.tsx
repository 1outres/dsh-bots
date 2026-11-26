import { type ReactNode, useState } from "react"
import type { EnvironmentHostPlacement } from "../../shared/environment-host"
import type { SetupInspection, SetupSite } from "../../shared/vm-host-setup"
import { messageOf } from "../remote-feed"
import type { FrameConfirmation } from "../settings-frame/flow"
import type { Translate } from "../types"
import { Button, ErrorText, PageTitle, useQuery } from "../ui"
import { BeforeBuildingGroup } from "./BeforeBuildingGroup"
import type { VmHostClient } from "./client"
import { PreflightGroup } from "./PreflightGroup"
import { PinnedConnection, SshConnection } from "./SshConnection"
import { type BuildForm, type BuildIntent, formOf, seedOf, startRequestOf } from "./setup-model"

export function BuildPage(props: {
  readonly t: Translate
  readonly host: VmHostClient
  readonly intent: BuildIntent
  readonly title: string
  readonly placement: EnvironmentHostPlacement
  confirm(request: FrameConfirmation): Promise<boolean>
  onDone(): void
  readonly onAnotherMachine?: () => void
}) {
  const { t, host, intent } = props
  const [seed] = useState(() => seedOf(intent))
  const [form, setForm] = useState<BuildForm>(() => formOf(seed))
  const [site, setSite] = useState<SetupSite | null>(seed.fixedSite)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const change = (next: Partial<BuildForm>) => setForm((before) => ({ ...before, ...next }))

  const start = async (inspection: SetupInspection) => {
    const request = startRequestOf(form, inspection)
    if (request === null) return
    if (intent.kind === "new" && props.placement.kind === "placed") {
      const confirmed = await props.confirm({
        title: t("build.switch.title"),
        description: t("vmHost.switch.description"),
        confirm: t("build.switch.accept"),
        tone: "danger",
      })
      if (!confirmed) return
    }
    setBusy(true)
    setFailure(null)
    try {
      await host.startSetup(request)
      change({ sudoPassword: "" })
      props.onDone()
    } catch (cause) {
      setFailure(t("build.failed", { message: messageOf(cause) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dshb-settings-groups" data-dshb-build-page={seed.site}>
      <PageTitle>{props.title}</PageTitle>
      {seed.site === "ssh" &&
        (seed.fixedSite?.kind === "ssh" ? (
          <PinnedConnection t={t} site={seed.fixedSite} />
        ) : (
          <SshConnection
            t={t}
            host={host}
            confirm={props.confirm}
            site={site}
            disabled={busy}
            onSite={setSite}
          />
        ))}
      {site !== null && (
        <Inspected
          t={t}
          host={host}
          site={site}
          httpsPort={form.httpsPort}
          onAnotherMachine={props.onAnotherMachine}
        >
          {(inspection) =>
            inspection.verdict === "ready" && (
              <>
                <BeforeBuildingGroup
                  t={t}
                  site={seed.site}
                  inspection={inspection}
                  form={form}
                  projectFixed={seed.projectFixed}
                  disabled={busy}
                  onChange={change}
                />
                {failure !== null && <ErrorText>{failure}</ErrorText>}
                <div className="dshb-vm-host-actions">
                  <Button variant="secondary" disabled={busy} onClick={props.onDone}>
                    {t("build.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || startRequestOf(form, inspection) === null}
                    onClick={() => void start(inspection)}
                    marks={{ "data-dshb-build-start": "" }}
                  >
                    {busy ? t("build.starting") : t("build.start")}
                  </Button>
                </div>
              </>
            )
          }
        </Inspected>
      )}
    </div>
  )
}

function Inspected(props: {
  readonly t: Translate
  readonly host: VmHostClient
  readonly site: SetupSite
  readonly httpsPort: number
  readonly onAnotherMachine?: () => void
  readonly children: (inspection: SetupInspection) => ReactNode
}) {
  const { site, httpsPort } = props
  const [round, setRound] = useState(0)
  const key = JSON.stringify({ site, httpsPort, round })
  const inspection = useQuery(key, (signal) => props.host.inspectSetup({ site, httpsPort }, signal))
  return (
    <>
      <PreflightGroup
        t={props.t}
        inspection={inspection}
        onAgain={() => setRound((value) => value + 1)}
        onAnotherMachine={site.kind === "this-machine" ? props.onAnotherMachine : undefined}
      />
      {inspection.status === "ready" && props.children(inspection.value)}
    </>
  )
}
