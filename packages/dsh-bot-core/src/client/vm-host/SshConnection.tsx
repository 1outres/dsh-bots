import { useRef, useState } from "react"
import type { HostKeyScan, PinnedHostKey, SetupSite, SshTarget } from "../../shared/vm-host-setup"
import { messageOf } from "../remote-feed"
import type { FrameConfirmation } from "../settings-frame/flow"
import type { Translate } from "../types"
import {
  BlockRow,
  Button,
  ButtonRow,
  COMMITTED,
  Code,
  Group,
  Row,
  StatusPill,
  TextFieldRow,
  useQuery,
} from "../ui"
import { Command } from "./Command"
import type { VmHostClient } from "./client"
import { addressText, hostKeyCommand, parseAddress } from "./setup-model"

type Scan =
  | { readonly status: "idle" }
  | { readonly status: "scanning" }
  | { readonly status: "ready"; readonly scan: HostKeyScan }
  | { readonly status: "failed"; readonly message: string }

const samePinned = (a: PinnedHostKey, b: PinnedHostKey) =>
  a.type === b.type && a.fingerprint === b.fingerprint

export function SshConnection(props: {
  readonly t: Translate
  readonly host: VmHostClient
  confirm(request: FrameConfirmation): Promise<boolean>
  readonly site: SetupSite | null
  readonly disabled: boolean
  onSite(site: SetupSite | null): void
}) {
  const { t, host, site } = props
  const [target, setTarget] = useState<SshTarget | null>(null)
  const [scan, setScan] = useState<Scan>({ status: "idle" })
  const scanning = useRef<AbortController | null>(null)
  const identity = useQuery("ssh-identity", () => host.setupIdentity())
  const trusted = site?.kind === "ssh" ? site.hostKey : null

  const connect = async () => {
    if (target === null) return
    scanning.current?.abort()
    const controller = new AbortController()
    scanning.current = controller
    props.onSite(null)
    setScan({ status: "scanning" })
    try {
      const found = await host.scanHostKey(target, controller.signal)
      if (!controller.signal.aborted) setScan({ status: "ready", scan: found })
    } catch (cause) {
      if (!controller.signal.aborted) setScan({ status: "failed", message: messageOf(cause) })
    }
  }

  const trust = async (scanned: HostKeyScan, key: PinnedHostKey) => {
    const confirmed = await props.confirm({
      title: t("hostKey.trust.title"),
      description: t("hostKey.trust.description", {
        command: hostKeyCommand(key),
        host: scanned.target.host,
        fingerprint: key.fingerprint,
      }),
      confirm: t("hostKey.trust.accept"),
      tone: "primary",
    })
    if (confirmed) props.onSite({ kind: "ssh", target: scanned.target, hostKey: key })
  }

  return (
    <>
      <Group title={t("ssh.title")} marks={{ "data-dshb-ssh": "" }}>
        <TextFieldRow
          label={t("vmHost.address")}
          value={target === null ? "" : addressText(target)}
          placeholder="user@host:22"
          disabled={props.disabled}
          validate={(text) => (parseAddress(text) === null ? t("ssh.address.invalid") : null)}
          commit={async (text) => {
            const next = parseAddress(text)
            if (next !== null && (target === null || addressText(next) !== addressText(target))) {
              scanning.current?.abort()
              setTarget(next)
              setScan({ status: "idle" })
              props.onSite(null)
            }
            return COMMITTED
          }}
          marks={{ "data-dshb-ssh-address": "" }}
        />
        {identity.status === "loading" && <Row label={t("ssh.identity.loading")} />}
        {identity.status === "failed" && (
          <Row
            label={t("ssh.authorizedKeys")}
            meta={t("ssh.identity.failed", { message: identity.message })}
            metaTone="danger"
          />
        )}
        {identity.status === "ready" &&
          (identity.value.authorizedKeysLine === undefined ? (
            <Row
              label={t("ssh.authorizedKeys")}
              trailing={<StatusPill tone="idle" label={t("ssh.identity.absent")} />}
            />
          ) : (
            <BlockRow
              label={t("ssh.authorizedKeys")}
              meta={identity.value.fingerprint}
              marks={{ "data-dshb-ssh-authorized-keys": "" }}
            >
              <Command t={t} text={identity.value.authorizedKeysLine} />
            </BlockRow>
          ))}
        <ButtonRow
          label={scan.status === "scanning" ? t("ssh.connecting") : t("ssh.connect")}
          disabled={props.disabled || target === null || scan.status === "scanning"}
          onClick={() => void connect()}
          marks={{ "data-dshb-ssh-connect": "" }}
        />
        {scan.status === "failed" && (
          <Row
            label={t("ssh.scan.failed", { message: scan.message })}
            metaTone="danger"
            marks={{ "data-dshb-ssh-scan-failed": "" }}
          />
        )}
      </Group>
      {scan.status === "ready" && (
        <Group title={t("hostKey.title")} marks={{ "data-dshb-host-key": "" }}>
          {scan.scan.keys.length === 0 && <Row label={t("hostKey.none")} />}
          {scan.scan.keys.map((key) => (
            <BlockRow
              key={`${key.type} ${key.fingerprint}`}
              label={key.type}
              meta={hostKeyCommand(key)}
              trailing={
                trusted !== null && samePinned(trusted, key) ? (
                  <StatusPill tone="success" label={t("hostKey.trusted")} />
                ) : (
                  <Button
                    variant="row"
                    disabled={props.disabled}
                    onClick={() => void trust(scan.scan, key)}
                    marks={{ "data-dshb-host-key-trust": key.type }}
                  >
                    {t("hostKey.trust")}
                  </Button>
                )
              }
              marks={{ "data-dshb-host-key-type": key.type }}
            >
              <Code>{key.fingerprint}</Code>
            </BlockRow>
          ))}
        </Group>
      )}
    </>
  )
}

export function PinnedConnection(props: {
  readonly t: Translate
  readonly site: Extract<SetupSite, { readonly kind: "ssh" }>
}) {
  const { t, site } = props
  return (
    <Group title={t("ssh.title")} marks={{ "data-dshb-ssh": "pinned" }}>
      <Row label={t("vmHost.address")} trailing={<Code>{addressText(site.target)}</Code>} />
      <BlockRow
        label={t("hostKey.title")}
        meta={site.hostKey.type}
        trailing={<StatusPill tone="success" label={t("hostKey.trusted")} />}
      >
        <Code>{site.hostKey.fingerprint}</Code>
      </BlockRow>
    </Group>
  )
}
