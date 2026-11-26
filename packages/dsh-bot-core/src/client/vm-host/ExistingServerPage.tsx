import type { FrameConfirmation } from "../settings-frame/flow"
import type { Translate } from "../types"
import { BlockRow, Group, PageTitle, Row, Segmented } from "../ui"
import { Command } from "./Command"
import type { VmHostClient } from "./client"
import { PairingGroup } from "./PairingGroup"
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
  return (
    <div className="dshb-settings-groups" data-dshb-existing-page="">
      <PageTitle>{t("setup.choice.existing")}</PageTitle>
      <Group>
        <Row
          label={t("existing.backend")}
          trailing={
            <Segmented
              label={t("existing.backend")}
              value="incus"
              choices={[
                { value: "incus", label: t("vmHost.backend.incus") },
                { value: "proxmox", label: t("existing.proxmox"), disabled: true },
              ]}
              onChange={() => {}}
              marks={{ "data-dshb-existing-backend": "" }}
            />
          }
        />
      </Group>
      <Group>
        <BlockRow label={t("existing.admin")} marks={{ "data-dshb-existing-admin": "" }}>
          <Command t={t} text={createProjectCommand(props.pluginVersion)} />
        </BlockRow>
      </Group>
      <PairingGroup
        t={t}
        host={props.host}
        confirm={props.confirm}
        project={props.project}
        onDone={props.onDone}
      />
    </div>
  )
}
