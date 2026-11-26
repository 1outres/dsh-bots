import { useState } from "react"
import { localeFormat } from "../locale-format"
import type { FrameConfirmation } from "../settings-frame/flow"
import type { Translate } from "../types"
import {
  BlockRow,
  Button,
  COMMITTED,
  Code,
  commitWith,
  ErrorText,
  Group,
  Row,
  Select,
  TextArea,
  TextFieldRow,
  useTextDraft,
} from "../ui"
import type { VmHostClient } from "./client"
import {
  emptyPairing,
  endpointUrlAllowed,
  fingerprintText,
  type PairingForm,
  pairingRequest,
  previewed,
  projectAllowed,
} from "./model"

const OTHER = "other"
const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export function PairingGroup(props: {
  readonly t: Translate
  readonly host: VmHostClient
  confirm(request: FrameConfirmation): Promise<boolean>
  readonly project: string
  onDone(): void
}) {
  const { t, host } = props
  const [form, setForm] = useState<PairingForm>(() => emptyPairing(props.project))
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const draft = useTextDraft({
    value: token,
    commit: (text) =>
      commitWith(
        async () => {
          const trimmed = text.trim()
          setToken(trimmed)
          setFailure(null)
          if (trimmed === "") {
            setForm((before) => emptyPairing(before.project))
            return
          }
          try {
            const preview = await host.previewToken(trimmed)
            setForm((before) => previewed(before, preview))
          } catch (cause) {
            setForm((before) => emptyPairing(before.project))
            throw cause
          }
        },
        (cause) => t("pairing.token.invalid", { message: messageOf(cause) }),
      ),
  })
  const now = Date.now()
  const request = pairingRequest(form, token, now)
  const { preview, address } = form
  const format = localeFormat(t)
  const pair = async () => {
    if (request === null) return
    const confirmed = await props.confirm({
      title: t("vmHost.switch.title", { url: request.url }),
      description: t("vmHost.switch.description"),
      confirm: t("vmHost.switch.accept"),
      tone: "danger",
    })
    if (!confirmed) return
    setBusy(true)
    setFailure(null)
    try {
      await host.pair(request)
      props.onDone()
    } catch (cause) {
      setFailure(t("pairing.failed", { message: messageOf(cause) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Group title={t("pairing.title")} marks={{ "data-dshb-vm-host-pairing": "" }}>
        <BlockRow
          label={t("pairing.token")}
          meta={draft.error ?? undefined}
          metaTone={draft.error === null ? undefined : "danger"}
        >
          <TextArea
            draft={draft}
            label={t("pairing.token")}
            placeholder={t("pairing.token.placeholder")}
            rows={3}
            disabled={busy}
            marks={{ "data-dshb-vm-host-token": "" }}
          />
        </BlockRow>
        {preview !== null && (
          <>
            <BlockRow
              label={t("vmHost.serverCertificate")}
              meta={t("pairing.compare")}
              marks={{ "data-dshb-vm-host-token-fingerprint": preview.serverFingerprint }}
            >
              <Code>{fingerprintText(preview.serverFingerprint)}</Code>
            </BlockRow>
            <Row
              label={t("pairing.expires")}
              meta={
                preview.expiresAt === undefined
                  ? t("pairing.never")
                  : preview.expiresAt <= now
                    ? t("pairing.expired")
                    : format.instant(preview.expiresAt, "dateTime")
              }
              metaTone={
                preview.expiresAt !== undefined && preview.expiresAt <= now ? "danger" : undefined
              }
            />
            <Row
              label={t("vmHost.address")}
              trailing={
                <Select
                  label={t("vmHost.address")}
                  value={address?.kind === "token" ? address.url : OTHER}
                  disabled={busy}
                  choices={[
                    ...preview.urls.map((url) => ({ value: url, label: url })),
                    { value: OTHER, label: t("pairing.address.other") },
                  ]}
                  onChange={(value) =>
                    setForm((before) => ({
                      ...before,
                      address:
                        value === OTHER
                          ? { kind: "other", url: "" }
                          : { kind: "token", url: value },
                    }))
                  }
                  marks={{ "data-dshb-vm-host-address": "" }}
                />
              }
            />
            {address?.kind === "other" && (
              <TextFieldRow
                label={t("pairing.address.otherLabel")}
                value={address.url}
                type="url"
                placeholder="https://vm-host:8443"
                validate={(text) =>
                  endpointUrlAllowed(text) ? null : t("pairing.address.invalid")
                }
                commit={async (text) => {
                  setForm((before) => ({ ...before, address: { kind: "other", url: text.trim() } }))
                  return COMMITTED
                }}
                marks={{ "data-dshb-vm-host-address-other": "" }}
              />
            )}
            <TextFieldRow
              label={t("vmHost.project")}
              value={form.project}
              validate={(text) => (projectAllowed(text) ? null : t("vmHost.project.invalid"))}
              commit={async (text) => {
                setForm((before) => ({ ...before, project: text.trim() }))
                return COMMITTED
              }}
              marks={{ "data-dshb-vm-host-pairing-project": "" }}
            />
          </>
        )}
      </Group>
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <div className="dshb-vm-host-actions">
        <Button variant="secondary" disabled={busy} onClick={props.onDone}>
          {t("pairing.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={busy || request === null}
          onClick={() => void pair()}
          marks={{ "data-dshb-vm-host-pair": "" }}
        >
          {busy ? t("pairing.pairing") : t("pairing.pair")}
        </Button>
      </div>
    </>
  )
}
