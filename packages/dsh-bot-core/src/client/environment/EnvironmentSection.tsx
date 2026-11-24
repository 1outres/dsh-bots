import { useEffect, useMemo, useState } from "react"
import {
  BOT_ENVIRONMENT_SPEC_KEYS,
  type BotEnvironmentApplication,
  type BotEnvironmentCapacity,
  type BotEnvironmentSpec,
  type BotEnvironmentSpecKey,
  type BotEnvironmentSpecProblem,
  type BotEnvironmentView,
} from "../../shared/environment"
import { useObservable } from "../hooks"
import type { SettingsSectionProps } from "../settings/sections"
import type { Translate } from "../types"
import { Button, ErrorText, Group, Row, StatusPill, TextInput, usePendingEdit } from "../ui"
import type { EnvironmentClient } from "./client"
import { ENVIRONMENT_KEY_LABEL, environmentValueText } from "./labels"
import { checkDraft, draftOf, type EnvironmentDraft, neededOf } from "./model"

export interface EnvironmentSectionDeps {
  readonly environment: EnvironmentClient
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** A bot's VM: its CPUs, memory and disk, saved together after a restart is confirmed. */
export function EnvironmentSection(props: SettingsSectionProps & EnvironmentSectionDeps) {
  const { t, bot, environment } = props
  const state = useObservable(environment.bot(bot.id))
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("environment.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("environment.unavailable", { message: state.message })}</ErrorText>
  }
  const view = state.value
  if (view.spec === undefined) {
    return (
      <div className="dshb-settings-groups" data-dshb-environment="">
        <Group>
          <Row
            label={t("environment.unread")}
            meta={view.application.state === "unread" ? view.application.reason : undefined}
            marks={{ "data-dshb-environment-unread": "" }}
          />
        </Group>
      </div>
    )
  }
  return <EnvironmentForm {...props} view={view} spec={view.spec} />
}

interface FormProps extends SettingsSectionProps, EnvironmentSectionDeps {
  readonly view: BotEnvironmentView
  readonly spec: BotEnvironmentSpec
}

function EnvironmentForm({ t, bot, environment, confirm, view, spec }: FormProps) {
  const stored = useMemo(() => draftOf(spec), [spec])
  const [draft, setDraft] = useState<EnvironmentDraft>(stored)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => setDraft(stored), [stored])
  const capacity = view.capacity.status === "ready" ? view.capacity.capacity : undefined
  const check = checkDraft(draft, spec, capacity, view.needs)
  usePendingEdit(check.changed.length > 0 || check.unreadable.length > 0)
  const blocked =
    saving ||
    capacity === undefined ||
    check.spec === undefined ||
    check.changed.length === 0 ||
    check.problems.length > 0

  const save = async () => {
    const next = check.spec
    if (next === undefined) return
    const confirmed = await confirm({
      title: t("environment.confirm.title"),
      description: t("environment.confirm.description", { bot: bot.name }),
      confirm: t("environment.confirm.accept"),
      tone: "danger",
    })
    if (!confirmed) return
    setSaving(true)
    setFailure(null)
    try {
      await environment.configure(bot.id, next)
    } catch (cause) {
      setFailure(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dshb-settings-groups" data-dshb-environment="">
      <Group>
        <ApplicationRow t={t} application={view.application} />
      </Group>
      <Group>
        {BOT_ENVIRONMENT_SPEC_KEYS.map((key) => (
          <SpecRow
            key={key}
            t={t}
            specKey={key}
            text={draft[key]}
            current={spec[key]}
            capacity={capacity}
            needed={neededOf(view.needs, key)}
            unreadable={check.unreadable.includes(key)}
            problem={check.problems.find((problem) => problem.key === key)}
            disabled={saving}
            onChange={(text) => setDraft((before) => ({ ...before, [key]: text }))}
          />
        ))}
      </Group>
      {view.capacity.status === "unavailable" && (
        <ErrorText>{t("environment.capacityFailed", { message: view.capacity.reason })}</ErrorText>
      )}
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <div className="dshb-environment-actions">
        <Button
          variant="secondary"
          disabled={saving || check.changed.length === 0}
          onClick={() => setDraft(stored)}
          marks={{ "data-dshb-environment-reset": "" }}
        >
          {t("environment.reset")}
        </Button>
        <Button
          variant="primary"
          disabled={blocked}
          onClick={() => void save()}
          marks={{ "data-dshb-environment-save": "" }}
        >
          {t("environment.save")}
        </Button>
      </div>
    </div>
  )
}

const APPLICATION_TONE = {
  unread: "idle",
  applying: "busy",
  applied: "success",
  failed: "danger",
} as const

function ApplicationRow({
  t,
  application,
}: {
  readonly t: Translate
  readonly application: BotEnvironmentApplication
}) {
  const meta =
    application.state === "failed"
      ? application.reason
      : application.state === "applying" && application.phase !== undefined
        ? t(`phase.${application.phase}`)
        : undefined
  return (
    <Row
      label={t("environment.state")}
      meta={meta}
      metaTone={application.state === "failed" ? "danger" : undefined}
      trailing={
        <StatusPill
          tone={APPLICATION_TONE[application.state]}
          label={t(`environment.state.${application.state}`)}
          marks={{ "data-dshb-environment-state": application.state }}
        />
      }
    />
  )
}

interface SpecRowProps {
  readonly t: Translate
  readonly specKey: BotEnvironmentSpecKey
  readonly text: string
  readonly current: number
  readonly capacity: BotEnvironmentCapacity | undefined
  readonly needed: { readonly value: number; readonly connectors: readonly string[] } | undefined
  readonly unreadable: boolean
  readonly problem: BotEnvironmentSpecProblem | undefined
  readonly disabled: boolean
  onChange(text: string): void
}

function problemText(t: Translate, problem: BotEnvironmentSpecProblem): string {
  const value = (number: number) => environmentValueText(t, problem.key, number)
  switch (problem.kind) {
    case "range":
      return t("environment.problem.range", {
        min: value(problem.range.min),
        max: value(problem.range.max),
        step: value(problem.range.step),
      })
    case "shrink":
      return t("environment.problem.shrink", { value: value(problem.current) })
    case "needed":
      return t("environment.problem.needed", {
        connectors: problem.connectors.join(", "),
        value: value(problem.need),
      })
  }
}

function SpecRow(props: SpecRowProps) {
  const { t, specKey, capacity, needed } = props
  const label = t(ENVIRONMENT_KEY_LABEL[specKey])
  const range = capacity?.[specKey]
  const value = (number: number) => environmentValueText(t, specKey, number)
  const facts = [
    ...(range === undefined
      ? []
      : [t("environment.range", { min: value(range.min), max: value(range.max) })]),
    ...(range?.growOnly === true ? [t("environment.growOnly")] : []),
    ...(needed === undefined
      ? []
      : [
          t("environment.needed", {
            connectors: needed.connectors.join(", "),
            value: value(needed.value),
          }),
        ]),
  ]
  const error = props.unreadable
    ? t("environment.problem.number")
    : props.problem === undefined
      ? undefined
      : problemText(t, props.problem)
  return (
    <Row
      label={label}
      meta={error ?? facts.join(" · ")}
      metaTone={error === undefined ? undefined : "danger"}
      marks={{ "data-dshb-environment-key": specKey }}
      trailing={
        <>
          <TextInput
            value={props.text}
            label={label}
            width="compact"
            disabled={props.disabled}
            onChange={props.onChange}
            marks={{ "data-dshb-environment-input": specKey }}
          />
          <span className="dshb-environment-unit">{t(`environment.unit.${specKey}`)}</span>
        </>
      }
    />
  )
}
