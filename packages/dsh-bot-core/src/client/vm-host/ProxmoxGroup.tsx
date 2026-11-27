import { useState } from "react"
import type { FrameConfirmation } from "../settings-frame/flow"
import type { Translate } from "../types"
import {
  BlockRow,
  Button,
  Code,
  commitWith,
  ErrorText,
  Group,
  Row,
  TextFieldRow,
  TextInput,
} from "../ui"
import type { VmHostClient } from "./client"
import { fingerprintText } from "./model"
import {
  emptyProxmox,
  ipv4Allowed,
  nameAllowed,
  nameserversOf,
  type ProxmoxForm,
  proxmoxPreviewed,
  proxmoxRequest,
  proxmoxUrlAllowed,
  tokenIdAllowed,
} from "./proxmox-model"

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

type TextKey = Exclude<keyof ProxmoxForm, "url" | "preview">

const FIELDS: readonly {
  readonly key: TextKey
  readonly allowed: (text: string) => boolean
  readonly secret?: boolean
  readonly placeholder?: string
}[] = [
  { key: "tokenId", allowed: tokenIdAllowed, placeholder: "dsh-bots@pve!plugin" },
  { key: "tokenSecret", allowed: (text) => text.trim() !== "", secret: true },
  { key: "node", allowed: nameAllowed, placeholder: "pve1" },
  { key: "pool", allowed: nameAllowed },
  { key: "storage", allowed: nameAllowed },
  { key: "bridge", allowed: nameAllowed },
  { key: "sshSource", allowed: ipv4Allowed },
  { key: "nameservers", allowed: (text) => nameserversOf(text) !== null },
]

export function ProxmoxGroup(props: {
  readonly t: Translate
  readonly host: VmHostClient
  confirm(request: FrameConfirmation): Promise<boolean>
  onDone(): void
}) {
  const { t, host } = props
  const [form, setForm] = useState<ProxmoxForm>(emptyProxmox)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const request = proxmoxRequest(form)
  const set = (change: Partial<ProxmoxForm>) => setForm((before) => ({ ...before, ...change }))
  const connect = async () => {
    if (request === null) return
    const confirmed = await props.confirm({
      title: t("vmHost.switch.title", { url: request.url }),
      description: t("vmHost.switch.description"),
      confirm: t("proxmox.connect"),
      tone: "danger",
    })
    if (!confirmed) return
    setBusy(true)
    setFailure(null)
    try {
      await host.connectCustom(request)
      props.onDone()
    } catch (cause) {
      setFailure(t("proxmox.failed", { message: messageOf(cause) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Group title={t("proxmox.title")} marks={{ "data-dshb-proxmox": "" }}>
        <TextFieldRow
          label={t("proxmox.url")}
          value={form.url}
          type="url"
          placeholder="https://pve.example:8006"
          disabled={busy}
          validate={(text) => (proxmoxUrlAllowed(text) ? null : t("pairing.address.invalid"))}
          commit={(text) =>
            commitWith(
              async () => {
                const url = text.trim()
                set({ url, preview: null })
                if (url === "") return
                const preview = await host.previewCustom({ backend: "proxmox", url })
                if (preview.backend !== "proxmox")
                  throw new Error("the VM host answered for another server")
                setForm((before) => proxmoxPreviewed({ ...before, url }, preview))
              },
              (cause) => t("proxmox.url.failed", { message: messageOf(cause) }),
            )
          }
          marks={{ "data-dshb-proxmox-url": "" }}
        />
        {form.preview !== null && (
          <BlockRow
            label={t("vmHost.serverCertificate")}
            meta={t("proxmox.compare")}
            marks={{ "data-dshb-proxmox-fingerprint": form.preview.serverFingerprint }}
          >
            <Code>{fingerprintText(form.preview.serverFingerprint)}</Code>
          </BlockRow>
        )}
        {form.preview !== null &&
          FIELDS.map((field) => {
            const value = form[field.key]
            const invalid = value.trim() !== "" && !field.allowed(value)
            return (
              <Row
                key={field.key}
                label={t(`proxmox.field.${field.key}`)}
                meta={
                  invalid
                    ? t(`proxmox.field.${field.key}.invalid`)
                    : t(`proxmox.field.${field.key}.meta`)
                }
                metaTone={invalid ? "danger" : undefined}
                trailing={
                  <TextInput
                    value={value}
                    onChange={(text) => set({ [field.key]: text })}
                    label={t(`proxmox.field.${field.key}`)}
                    placeholder={field.placeholder}
                    secret={field.secret}
                    width="compact"
                    disabled={busy}
                    marks={{ "data-dshb-proxmox-field": field.key }}
                  />
                }
              />
            )
          })}
      </Group>
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <div className="dshb-vm-host-actions">
        <Button variant="secondary" disabled={busy} onClick={props.onDone}>
          {t("pairing.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={busy || request === null}
          onClick={() => void connect()}
          marks={{ "data-dshb-proxmox-connect": "" }}
        >
          {busy ? t("proxmox.connecting") : t("proxmox.connect")}
        </Button>
      </div>
    </>
  )
}
