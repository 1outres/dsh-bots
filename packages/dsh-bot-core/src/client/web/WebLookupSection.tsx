import { useEffect, useMemo } from "react"
import {
  BOT_WEB_CAPABILITIES,
  type BotWebCapability,
  type BotWebCapabilityStatus,
  type BotWebSecretView,
  type BotWebTestResult,
  type BotWebText,
  type BotWebUnavailableReason,
  type BotWebView,
} from "../../shared/web"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { useObservable } from "../hooks"
import type { MessageKey } from "../i18n"
import type { Translate } from "../types"
import { Button } from "../ui/Button"
import { COMMITTED, commitWith } from "../ui/commit"
import { ErrorText } from "../ui/EmptyState"
import { Group } from "../ui/Group"
import { Row } from "../ui/Row"
import { SecretRow } from "../ui/SecretRow"
import { type PillTone, StatusPill } from "../ui/StatusPill"
import { Switch } from "../ui/Switch"
import type { WebLookupFeed } from "./feed"
import {
  canSwitch,
  canTest,
  createWebLookupModel,
  TEST_RESULT_MS,
  type WebLookupForm,
  type WebLookupModel,
  type WebTestState,
} from "./model"

/** What the section needs of the surface it is on: the dsh-bots settings or the welcome guide. */
export type WebLookupSurface = Pick<GlobalSettingsSectionProps, "t" | "confirm">

export interface WebLookupSectionDeps {
  readonly feed: WebLookupFeed
  /** A backend's text in the active language. */
  text(text: BotWebText): string
}

const CAPABILITY_LABEL: Readonly<Record<BotWebCapability, MessageKey>> = {
  search: "web.capability.search",
  fetch: "web.capability.fetch",
}

const UNAVAILABLE: Readonly<Record<BotWebUnavailableReason, MessageKey>> = {
  "not-registered": "web.status.notRegistered",
  "no-capability": "web.status.noCapability",
  "no-credentials-service": "web.status.noCredentials",
}

type TestFailure = Extract<BotWebTestResult, { ok: false }>["reason"]

const TEST_FAILURE: Readonly<Record<TestFailure, MessageKey>> = {
  "invalid-secret": "web.test.invalidSecret",
  "no-credits": "web.test.noCredits",
  "rate-limited": "web.test.rateLimited",
  unreachable: "web.test.unreachable",
  unexpected: "web.test.unexpected",
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** What the key's row shows in place of its pill while a test runs or just ended. */
function testPill(
  t: Translate,
  test: WebTestState,
): { tone: PillTone; label: string; detail?: string; mark: string } | null {
  switch (test.state) {
    case "idle":
      return null
    case "running":
      return { tone: "busy", label: t("web.test.running"), mark: "running" }
    case "failed":
      return { tone: "danger", label: t("web.test.failed"), detail: test.message, mark: "failed" }
    case "done":
      return test.result.ok
        ? { tone: "success", label: t("web.test.ok"), mark: "ok" }
        : {
            tone: "danger",
            label: t(TEST_FAILURE[test.result.reason]),
            detail: test.result.message,
            mark: test.result.reason,
          }
  }
}

/** Web lookup of every bot: the backend's key (with its test) and the capabilities' switches. */
export function WebLookupSection(props: WebLookupSurface & WebLookupSectionDeps) {
  const { t, feed } = props
  const state = useObservable(feed)
  const model = useMemo(() => createWebLookupModel(feed), [feed])
  const form = useObservable(model)
  const settled = form.test.state === "done" || form.test.state === "failed"
  useEffect(() => {
    if (!settled) return
    const timer = setTimeout(() => model.settleTest(), TEST_RESULT_MS)
    return () => clearTimeout(timer)
  }, [model, settled])

  return (
    <div className="dshb-web" data-dshb-web-lookup="">
      {state.status === "failed" && (
        <ErrorText>{t("web.unavailable", { message: state.failure.message })}</ErrorText>
      )}
      {state.status === "ready" && (
        <WebLookupBody {...props} view={state.view} model={model} form={form} />
      )}
    </div>
  )
}

interface BodyProps extends WebLookupSurface, WebLookupSectionDeps {
  readonly view: BotWebView
  readonly model: WebLookupModel
  readonly form: WebLookupForm
}

function WebLookupBody(props: BodyProps) {
  const { t, text, view } = props
  const backend = view.backend
  return (
    <>
      {backend === null ? (
        <ErrorText>{t("web.backend.missing", { backend: view.settings.backend })}</ErrorText>
      ) : (
        <Group title={text(backend.name)} marks={{ "data-dshb-web-backend": backend.id }}>
          {backend.secrets.map((secret) => (
            <SecretField key={secret.key} {...props} secret={secret} />
          ))}
        </Group>
      )}
      <Group title={t("web.capabilities")}>
        {BOT_WEB_CAPABILITIES.map((capability) => (
          <CapabilityRow key={capability} {...props} capability={capability} />
        ))}
      </Group>
      {props.form.error !== null && (
        <ErrorText>{t("error.generic", { message: props.form.error })}</ErrorText>
      )}
    </>
  )
}

function CapabilityRow(props: BodyProps & { readonly capability: BotWebCapability }) {
  const { t, view, model, form, capability } = props
  const status: BotWebCapabilityStatus = view.status[capability]
  const label = t(CAPABILITY_LABEL[capability])
  return (
    <Row
      label={label}
      marks={{ "data-dshb-web-capability": capability, "data-dshb-web-status": status.state }}
      trailing={
        <>
          {status.state === "unavailable" && (
            <span title={t(UNAVAILABLE[status.reason])}>
              <StatusPill tone="warning" label={t("web.status.unavailable")} />
            </span>
          )}
          <Switch
            checked={view.settings[capability]}
            label={label}
            disabled={!canSwitch(view, form)}
            onChange={(on) => void model.setEnabled(capability, on)}
            marks={{ "data-dshb-web-switch": capability }}
          />
        </>
      }
    />
  )
}

function SecretField(props: BodyProps & { readonly secret: BotWebSecretView }) {
  const { t, text, view, model, form, secret, confirm } = props
  const label = text(secret.label)
  const failed = (cause: unknown) => t("error.generic", { message: messageOf(cause) })
  const pill = testPill(t, form.test)
  return (
    <SecretRow
      t={t}
      label={label}
      saved={secret.set}
      validate={(value) => (value.trim() === "" ? t("web.secret.empty") : null)}
      commit={(value) => commitWith(() => model.saveSecret(secret.key, value), failed)}
      remove={async () => {
        const confirmed = await confirm({
          title: t("web.secret.removeTitle", { secret: label }),
          description: t("web.secret.removeDescription"),
          confirm: t("web.secret.remove"),
          tone: "danger",
        })
        if (!confirmed) return COMMITTED
        return commitWith(() => model.clearSecret(secret.key), failed)
      }}
      status={
        pill === null ? undefined : (
          <span title={pill.detail}>
            <StatusPill
              tone={pill.tone}
              label={pill.label}
              marks={{ "data-dshb-web-test-result": pill.mark }}
            />
          </span>
        )
      }
      actions={
        secret.set && (
          <Button
            variant="row"
            disabled={!canTest(view, form)}
            onClick={() => void model.test()}
            marks={{ "data-dshb-web-test": "" }}
          >
            {t("web.test.run")}
          </Button>
        )
      }
      marks={{ "data-dshb-web-secret": secret.set ? "set" : "unset" }}
    />
  )
}
