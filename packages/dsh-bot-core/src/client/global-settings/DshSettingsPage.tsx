import type { SettingsSectionOwnerProps } from "../dsh/settings"
import type { Translate } from "../types"
import { Button } from "../ui/Button"
import { Group } from "../ui/Group"
import { Row } from "../ui/Row"

/** What bot-core injects into its page of DSH's settings. */
export interface DshSettingsPageFace {
  openGlobalSettings(): void
}

/** Leave DSH's settings for the dsh-bots settings: DSH's panel closes first, so the two never stack. */
export function leaveForGlobalSettings(
  owner: SettingsSectionOwnerProps,
  face: DshSettingsPageFace,
): void {
  owner.close()
  face.openGlobalSettings()
}

/** bot-core's page in DSH's settings: no settings of its own, only the way to the dsh-bots settings. */
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
