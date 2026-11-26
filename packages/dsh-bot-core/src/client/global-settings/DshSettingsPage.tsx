import type { SettingsSectionOwnerProps } from "../dsh/settings"
import type { Translate } from "../types"
import { Button } from "../ui/Button"
import { Group } from "../ui/Group"
import { Row } from "../ui/Row"

export interface DshSettingsPageFace {
  openGlobalSettings(): void
}

export function leaveForGlobalSettings(
  owner: SettingsSectionOwnerProps,
  face: DshSettingsPageFace,
): void {
  owner.close()
  face.openGlobalSettings()
}

export function DshSettingsPage(
  props: SettingsSectionOwnerProps & DshSettingsPageFace & { readonly t: Translate },
) {
  const { t } = props
  return (
    <div className="dshb-dsh-settings" data-dshb-dsh-settings="">
      <Group>
        <Row
          label={t("section.globalSettings")}
          trailing={
            <Button
              variant="row"
              onClick={() => leaveForGlobalSettings(props, props)}
              marks={{ "data-dshb-dsh-settings-open": "" }}
            >
              {t("dshSettings.open")}
            </Button>
          }
        />
      </Group>
    </div>
  )
}
