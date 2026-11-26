import type { SetupInspection } from "../../shared/vm-host-setup"
import type { Translate } from "../types"
import {
  BlockRow,
  COMMITTED,
  Code,
  Group,
  Row,
  Segmented,
  Switch,
  TextFieldRow,
  TextInput,
} from "../ui"
import { projectAllowed } from "./model"
import {
  type BuildForm,
  type ChangeLine,
  changesOf,
  parsePort,
  passwordNeeded,
  type SiteKind,
} from "./setup-model"

export function BeforeBuildingGroup(props: {
  readonly t: Translate
  readonly site: SiteKind
  readonly inspection: Extract<SetupInspection, { readonly verdict: "ready" }>
  readonly form: BuildForm
  readonly projectFixed: boolean
  readonly disabled: boolean
  onChange(change: Partial<BuildForm>): void
}) {
  const { t, inspection, form, disabled } = props
  const zabbly = inspection.consents.find((need) => need.id === "zabbly")
  return (
    <Group title={t("build.title")} marks={{ "data-dshb-build": "" }}>
      {props.projectFixed ? (
        <Row label={t("vmHost.project")} trailing={<Code>{form.project}</Code>} />
      ) : (
        <TextFieldRow
          label={t("vmHost.project")}
          value={form.project}
          disabled={disabled}
          validate={(text) => (projectAllowed(text) ? null : t("vmHost.project.invalid"))}
          commit={async (text) => {
            props.onChange({ project: text.trim() })
            return COMMITTED
          }}
          marks={{ "data-dshb-build-project": "" }}
        />
      )}
      <TextFieldRow
        label={t("build.port")}
        value={String(form.httpsPort)}
        disabled={disabled}
        validate={(text) => (parsePort(text) === null ? t("build.port.invalid") : null)}
        commit={async (text) => {
          const port = parsePort(text)
          if (port !== null) props.onChange({ httpsPort: port })
          return COMMITTED
        }}
        marks={{ "data-dshb-build-port": "" }}
      />
      {passwordNeeded(inspection) && (
        <Row
          label={t("build.password")}
          trailing={
            <TextInput
              value={form.sudoPassword}
              onChange={(sudoPassword) => props.onChange({ sudoPassword })}
              label={t("build.password")}
              secret
              width="compact"
              disabled={disabled}
              marks={{ "data-dshb-build-password": "" }}
            />
          }
        />
      )}
      {zabbly !== undefined && (
        <Row
          label={t("build.zabbly")}
          meta={t("build.zabbly.key", { key: zabbly.signingKey })}
          trailing={
            <Switch
              checked={form.consents.includes("zabbly")}
              onChange={(on) =>
                props.onChange({
                  consents: on
                    ? [...form.consents, "zabbly"]
                    : form.consents.filter((id) => id !== "zabbly"),
                })
              }
              label={t("build.zabbly")}
              disabled={disabled}
              marks={{ "data-dshb-build-zabbly": "" }}
            />
          }
        />
      )}
      {props.site === "ssh" && (
        <Row
          label={t("build.identity")}
          trailing={
            <Segmented
              label={t("build.identity")}
              value={form.identityAfter}
              disabled={disabled}
              choices={[
                { value: "keep", label: t("build.identity.keep") },
                { value: "remove", label: t("build.identity.remove") },
              ]}
              onChange={(identityAfter) => props.onChange({ identityAfter })}
              marks={{ "data-dshb-build-identity": "" }}
            />
          }
        />
      )}
      <BlockRow label={t("build.changes")} marks={{ "data-dshb-build-changes": "" }}>
        <ul className="dshb-vm-host-changes">
          {changesOf(props.site, form, inspection.consents).map((line) => (
            <li key={line.key}>{changeText(t, line)}</li>
          ))}
        </ul>
      </BlockRow>
    </Group>
  )
}

function changeText(t: Translate, line: ChangeLine): string {
  switch (line.key) {
    case "changes.incus":
    case "changes.trust":
      return t(line.key, { project: line.project })
    case "changes.https.loopback":
    case "changes.https.all":
      return t(line.key, { port: line.port })
    default:
      return t(line.key)
  }
}
