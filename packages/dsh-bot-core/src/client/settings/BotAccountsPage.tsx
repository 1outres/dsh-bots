import type { BotView } from "../../shared/bots"
import type { BotConnectionsSnapshot, ConnectionProviderView } from "../../shared/connections"
import { AccountsGroup } from "../accounts/AccountsGroup"
import type { ConnectionsFeed } from "../connections-model"
import type { Translate } from "../types"
import { Button, Group, PageTitle, Row, StatusPill, Tag } from "../ui"
import type { SettingsSectionProps } from "./sections"

export interface BotAccountsPageProps {
  readonly t: Translate
  readonly bot: BotView
  readonly provider: ConnectionProviderView
  readonly snapshot: BotConnectionsSnapshot
  readonly connections: ConnectionsFeed
  readonly confirm: SettingsSectionProps["confirm"]
  openGlobalSettings(): void
}

export function BotAccountsPage(props: BotAccountsPageProps) {
  const { t, provider } = props
  return (
    <div className="dshb-settings-groups" data-dshb-accounts-page={provider.id}>
      <PageTitle tag={provider.development ? <Tag>{t("connections.dev")}</Tag> : undefined}>
        {provider.name}
      </PageTitle>
      {!provider.client.configured && (
        <Group>
          <Row
            label={t("connections.client")}
            trailing={
              <>
                <StatusPill tone="warning" label={t("connections.standing.unconfigured")} />
                <Button
                  variant="row"
                  onClick={props.openGlobalSettings}
                  marks={{ "data-dshb-connections-setup": "" }}
                >
                  {t("connections.setup.open")}
                </Button>
              </>
            }
          />
        </Group>
      )}
      <AccountsGroup
        t={t}
        provider={provider}
        snapshot={props.snapshot}
        connections={props.connections}
        confirm={props.confirm}
        bot={props.bot}
      />
    </div>
  )
}
