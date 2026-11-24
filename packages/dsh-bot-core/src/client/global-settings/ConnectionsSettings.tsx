import type { ConnectionProviderView, OAuthSecretChange } from "../../shared/connections"
import { AccountsGroup } from "../accounts/AccountsGroup"
import type { ConnectionsFeed } from "../connections-model"
import { redirectUriOf } from "../connections-view"
import { useObservable } from "../hooks"
import { IconConnectors } from "../icons"
import { failureText } from "../settings/failure-text"
import type { Translate } from "../types"
import {
  Code,
  type CommitResult,
  CopyButton,
  commitWith,
  EmptyState,
  ErrorText,
  Group,
  LinkRow,
  Row,
  SecretRow,
  Tag,
  TextFieldRow,
} from "../ui"
import type { GlobalSettingsSectionProps } from "./sections"

export interface ConnectionsSettingsDeps {
  readonly connections: ConnectionsFeed
}

/** The dsh-bots settings of accounts: each provider's OAuth client, and every connected account. */
export function ConnectionsSettings({
  t,
  confirm,
  connections,
}: GlobalSettingsSectionProps & ConnectionsSettingsDeps) {
  const state = useObservable(connections)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("connections.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("connections.unavailable", { message: state.failure.message })}</ErrorText>
  }
  const { providers } = state.snapshot
  if (providers.length === 0) {
    return <EmptyState icon={<IconConnectors size={28} />} title={t("global.connections.none")} />
  }
  return (
    <div className="dshb-settings-groups" data-dshb-connections-settings="">
      {providers.map((provider) => (
        <div key={provider.id} className="dshb-settings-groups" data-dshb-oauth={provider.id}>
          <OAuthClient t={t} provider={provider} connections={connections} />
          {provider.client.configured && (
            <AccountsGroup
              t={t}
              provider={provider}
              snapshot={state.snapshot}
              connections={connections}
              confirm={confirm}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function OAuthClient(props: {
  readonly t: Translate
  readonly provider: ConnectionProviderView
  readonly connections: ConnectionsFeed
}) {
  const { t, provider, connections } = props
  const redirectUri = redirectUriOf(window.location.origin, provider)
  const configure = (clientId: string, clientSecret: OAuthSecretChange): Promise<CommitResult> =>
    commitWith(
      () => connections.configureClient(provider.id, { clientId, clientSecret }),
      (cause) => failureText(t, cause),
    )
  const clientId = provider.client.clientId ?? ""
  return (
    <Group
      title={provider.name}
      tag={provider.development ? <Tag>{t("connections.dev")}</Tag> : undefined}
    >
      <Row
        label={t("oauth.redirect")}
        trailing={
          <>
            <Code>{redirectUri}</Code>
            <CopyButton
              text={redirectUri}
              label={t("oauth.copy")}
              copiedLabel={t("oauth.copied")}
              marks={{ "data-dshb-oauth-copy": "" }}
            />
          </>
        }
        marks={{ "data-dshb-oauth-redirect": redirectUri }}
      />
      <TextFieldRow
        label={t("oauth.clientId")}
        value={clientId}
        commit={(text) => configure(text.trim(), { op: "keep" })}
        marks={{ "data-dshb-oauth-client": "" }}
      />
      <SecretRow
        t={t}
        label={t("oauth.clientSecret")}
        saved={provider.client.secretSet}
        commit={(secret) => configure(clientId, { op: "set", value: secret.trim() })}
        remove={() => configure(clientId, { op: "clear" })}
        marks={{ "data-dshb-oauth-secret": "" }}
      />
      {provider.guide !== undefined && (
        <LinkRow
          label={t("oauth.guide")}
          href={provider.guide}
          marks={{ "data-dshb-oauth-guide": "" }}
        />
      )}
    </Group>
  )
}
