import { useState } from "react"
import type { VmBackendKind } from "../../shared/environment-host"
import type { FrameConfirmation } from "../settings-frame/flow"
import type { Translate } from "../types"
import { BlockRow, Group, PageTitle, Row, Segmented } from "../ui"
import { Command } from "./Command"
import type { VmHostClient } from "./client"
import { PairingGroup } from "./PairingGroup"
import { ProxmoxGroup } from "./ProxmoxGroup"
import { createPoolCommand } from "./proxmox-model"
import { createProjectCommand } from "./setup-model"

export function ExistingServerPage(props: {
  readonly t: Translate
  readonly host: VmHostClient
  confirm(request: FrameConfirmation): Promise<boolean>
  readonly project: string
  readonly pluginVersion: string
  onDone(): void
}) {
  const { t } = props
  const [backend, setBackend] = useState<VmBackendKind>("incus")
  const admin =
    backend === "incus"
      ? createProjectCommand(props.pluginVersion)
      : createPoolCommand(props.pluginVersion)
  return (
    <div className="dshb-settings-groups" data-dshb-existing-page="">
      <PageTitle>{t("setup.choice.existing")}</PageTitle>
      <Group>
        <Row
          label={t("existing.backend")}
          trailing={
            <Segmented<VmBackendKind>
              label={t("existing.backend")}
              value={backend}
              choices={[
                { value: "incus", label: t("vmHost.backend.incus") },
                { value: "proxmox", label: t("vmHost.backend.proxmox") },
              ]}
              onChange={setBackend}
              marks={{ "data-dshb-existing-backend": "" }}
            />
          }
        />
      </Group>
      <Group>
        <BlockRow label={t("existing.admin")} marks={{ "data-dshb-existing-admin": backend }}>
          <Command t={t} text={admin} />
        </BlockRow>
      </Group>
      {backend === "incus" ? (
        <PairingGroup
          t={t}
          host={props.host}
          confirm={props.confirm}
          project={props.project}
          onDone={props.onDone}
        />
      ) : (
        <ProxmoxGroup t={t} host={props.host} confirm={props.confirm} onDone={props.onDone} />
      )}
    </div>
  )
}
