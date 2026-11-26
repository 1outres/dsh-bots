import { useMemo, useState } from "react"
import type {
  BotSkillSummary,
  BotSkillsView,
  SkillOperation,
  SkillOrigin,
  SkillRetention,
  SkillVersionSummary,
} from "../../shared/skills"
import { useObservable } from "../hooks"
import type { MessageKey } from "../i18n"
import { IconSkills } from "../icons"
import { localeFormat } from "../locale-format"
import type { SettingsSectionProps } from "../settings/sections"
import type { Translate } from "../types"
import {
  Button,
  EmptyState,
  ErrorText,
  Group,
  NavRow,
  PageTitle,
  Row,
  RowMenu,
  Segmented,
  Switch,
  Tag,
} from "../ui"
import type { SkillsClient } from "./client"
import type { FileChange } from "./diff"
import { createVersionTab, skillHistory, skillVersion, type VersionTab } from "./model"
import { skillDetail, skillsPageOf, versionDetail } from "./pages"

export interface SkillsSectionDeps {
  readonly skills: SkillsClient
}

const OPERATION: Readonly<Record<SkillOperation, MessageKey>> = {
  create: "skills.operation.create",
  patch: "skills.operation.patch",
  write_file: "skills.operation.write_file",
  remove_file: "skills.operation.remove_file",
  archive: "skills.operation.archive",
  restore: "skills.operation.restore",
  observed: "skills.operation.observed",
}

const ORIGIN: Readonly<Record<SkillOrigin["kind"], MessageKey>> = {
  conversation: "skills.origin.conversation",
  review: "skills.origin.review",
  owner: "skills.origin.owner",
  files: "skills.origin.files",
  curator: "skills.origin.curator",
}

const DAY_MS = 24 * 60 * 60_000

const FILE_CHANGE: Readonly<Record<FileChange["kind"], MessageKey>> = {
  added: "skills.file.added",
  removed: "skills.file.removed",
  changed: "skills.file.changed",
  same: "skills.file.same",
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export function SkillsSection(props: SettingsSectionProps & SkillsSectionDeps) {
  const { t, bot, page, skills } = props
  const state = useObservable(skills.bot(bot.id))
  if (state.status === "failed") {
    return <ErrorText>{t("skills.unavailable", { message: state.message })}</ErrorText>
  }
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("skills.loading")} />
      </Group>
    )
  }
  const shown = skillsPageOf(page.detail)
  if (shown.kind === "skill") {
    return <SkillPage {...props} name={shown.name} view={state.value} />
  }
  if (shown.kind === "version") {
    return <VersionPage {...props} name={shown.name} versionId={shown.versionId} />
  }
  return <SkillList {...props} view={state.value} />
}

function usageOf(t: Translate, skill: BotSkillSummary): string {
  const format = localeFormat(t)
  if (skill.uses === 0 || skill.lastUsedAt === undefined) return t("skills.neverUsed")
  return `${format.count("skills.uses", skill.uses)} · ${t("skills.lastUsed", { at: format.instant(skill.lastUsedAt, "dateTime") })}`
}

export function retentionOf(
  t: Translate,
  retention: SkillRetention | undefined,
  now: number,
): string | undefined {
  switch (retention?.kind) {
    case "unused": {
      const days = Math.ceil((retention.archivesAt - now) / DAY_MS)
      return days <= 0 ? t("skills.archivesSoon") : localeFormat(t).count("skills.archivesIn", days)
    }
    case "scheduled":
      return t("skills.scheduled")
    case "kept":
    case "unseen":
    case undefined:
      return undefined
  }
}

function usageLine(t: Translate, skill: BotSkillSummary, now: number): string {
  const retention = retentionOf(t, skill.retention, now)
  return retention === undefined ? usageOf(t, skill) : `${usageOf(t, skill)} · ${retention}`
}

function SkillList(
  props: SettingsSectionProps & SkillsSectionDeps & { readonly view: BotSkillsView },
) {
  const { t, bot, page, skills, view } = props
  const [error, setError] = useState<{ readonly row: string; readonly message: string } | null>(
    null,
  )
  const library = view.library
  const now = Date.now()
  const failed = (row: string) => (cause: unknown) => {
    setError({ row, message: t("error.generic", { message: messageOf(cause) }) })
  }
  const errorOf = (row: string) => (error?.row === row ? error.message : undefined)
  const setting = (
    row: "review" | "curator",
    label: string,
    checked: boolean,
    change: (enabled: boolean) => Promise<unknown>,
  ) => (
    <Row
      label={label}
      meta={errorOf(row)}
      metaTone={errorOf(row) === undefined ? undefined : "danger"}
      trailing={
        <Switch
          checked={checked}
          label={label}
          onChange={(enabled) => {
            setError(null)
            change(enabled).catch(failed(row))
          }}
          marks={{ [`data-dshb-skills-${row}`]: "" }}
        />
      }
    />
  )
  const review = (
    <Group>
      {setting("review", t("skills.review"), view.review, (enabled) =>
        skills.setReview(bot.id, enabled),
      )}
      {setting("curator", t("skills.curator"), view.curator, (enabled) =>
        skills.setCurator(bot.id, enabled),
      )}
    </Group>
  )
  const setKeep = (skill: BotSkillSummary, keep: boolean) => {
    setError(null)
    skills.setKeep(bot.id, skill.name, keep).catch(failed(`skill:${skill.name}`))
  }
  if (library.state === "loading") {
    return (
      <div className="dshb-settings-groups" data-dshb-skills="">
        {review}
        <Group>
          <Row label={t("skills.loading")} />
        </Group>
      </div>
    )
  }
  if (library.state === "unavailable") {
    return (
      <div className="dshb-settings-groups" data-dshb-skills="">
        {review}
        <ErrorText>{t("skills.unavailable", { message: library.message })}</ErrorText>
      </div>
    )
  }
  const active = library.skills.filter((skill) => !skill.archived)
  const archived = library.skills.filter((skill) => skill.archived)
  const row = (skill: BotSkillSummary) => (
    <NavRow
      key={`${skill.archived ? "archived" : "active"}:${skill.name}`}
      label={skill.name}
      meta={errorOf(`skill:${skill.name}`) ?? skill.description}
      metaTone={errorOf(`skill:${skill.name}`) === undefined ? undefined : "danger"}
      trailing={
        <>
          <span className="dshb-skills-usage">{usageLine(t, skill, now)}</span>
          {skill.keep && <Tag>{t("skills.keep")}</Tag>}
          <RowMenu
            label={t("skills.more", { name: skill.name })}
            items={[
              {
                id: "keep",
                label: skill.keep ? t("skills.keep.off") : t("skills.keep.on"),
                run: () => setKeep(skill, !skill.keep),
              },
            ]}
            marks={{ "data-dshb-skill-menu": skill.name }}
          />
        </>
      }
      onOpen={() => page.open(skillDetail(skill.name))}
      marks={{
        "data-dshb-skill": skill.name,
        ...(skill.keep ? { "data-dshb-skill-keep": "" } : {}),
      }}
    />
  )
  return (
    <div className="dshb-settings-groups" data-dshb-skills="">
      {review}
      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={<IconSkills size={28} />}
          title={t("skills.none")}
          marks={{ "data-dshb-skills-none": "" }}
        />
      ) : null}
      {active.length > 0 && (
        <Group title={t("skills.group.active")} marks={{ "data-dshb-skills-active": "" }}>
          {active.map(row)}
        </Group>
      )}
      {archived.length > 0 && (
        <Group title={t("skills.group.archived")} marks={{ "data-dshb-skills-archived": "" }}>
          {archived.map(row)}
        </Group>
      )}
      {library.invalid.length > 0 && (
        <Group title={t("skills.group.invalid")} marks={{ "data-dshb-skills-invalid": "" }}>
          {library.invalid.map((entry) => (
            <Row key={entry.path} label={entry.path} meta={entry.problem} metaTone="danger" />
          ))}
        </Group>
      )}
    </div>
  )
}

function versionMeta(t: Translate, version: SkillVersionSummary): string {
  return [
    localeFormat(t).instant(version.at, "dateTime"),
    t(ORIGIN[version.origin.kind]),
    ...(version.absorbedInto === undefined
      ? []
      : [t("skills.absorbedInto", { name: version.absorbedInto })]),
    ...(version.reason === undefined ? [] : [version.reason]),
  ].join(" · ")
}

function SkillPage(
  props: SettingsSectionProps &
    SkillsSectionDeps & { readonly name: string; readonly view: BotSkillsView },
) {
  const { t, bot, page, skills, name, view } = props
  const history = useObservable(
    useMemo(() => skillHistory(skills, bot.id, name), [skills, bot.id, name]),
  )
  const [error, setError] = useState<string | null>(null)
  const [keepError, setKeepError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const summary =
    view.library.state === "ready"
      ? view.library.skills.find((skill) => skill.name === name)
      : undefined
  const restore = async () => {
    const confirmed = await props.confirm({
      title: t("skills.restoreArchived.title", { name }),
      description: t("skills.restoreArchived.description"),
      confirm: t("skills.restoreArchived.confirm"),
      tone: "primary",
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await skills.restoreArchived(bot.id, name)
    } catch (cause) {
      setError(t("skills.restoreFailed", { message: messageOf(cause) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dshb-settings-groups" data-dshb-skill-page={name}>
      <PageTitle
        tag={summary?.archived === true ? <Tag>{t("skills.archived")}</Tag> : undefined}
        trailing={
          summary?.archived === true ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void restore()}
              marks={{ "data-dshb-skill-restore": "" }}
            >
              {t("skills.restoreArchived")}
            </Button>
          ) : undefined
        }
      >
        {name}
      </PageTitle>
      {summary !== undefined && (
        <Group>
          <Row label={summary.description} meta={usageLine(t, summary, Date.now())} />
          <Row
            label={t("skills.keep")}
            meta={keepError ?? undefined}
            metaTone={keepError === null ? undefined : "danger"}
            trailing={
              <Switch
                checked={summary.keep}
                label={t("skills.keep")}
                onChange={(keep) => {
                  setKeepError(null)
                  skills.setKeep(bot.id, name, keep).catch((cause: unknown) => {
                    setKeepError(t("error.generic", { message: messageOf(cause) }))
                  })
                }}
                marks={{ "data-dshb-skill-keep-switch": "" }}
              />
            }
          />
        </Group>
      )}
      {error !== null && <ErrorText>{error}</ErrorText>}
      {history.status === "failed" ? (
        <ErrorText>{t("skills.loadFailed", { message: history.message })}</ErrorText>
      ) : history.status === "loading" ? (
        <Group title={t("skills.history")}>
          <Row label={t("skills.loading")} />
        </Group>
      ) : (
        <Group title={t("skills.history")} marks={{ "data-dshb-skill-history": "" }}>
          {history.value.versions.length === 0 ? (
            <Row label={t("skills.noHistory")} />
          ) : (
            history.value.versions.map((version) => (
              <NavRow
                key={version.id}
                label={t(OPERATION[version.operation])}
                meta={versionMeta(t, version)}
                trailing={version.archived ? <Tag>{t("skills.archived")}</Tag> : undefined}
                onOpen={() => page.open(versionDetail(name, version.id))}
                marks={{ "data-dshb-skill-version": version.id }}
              />
            ))
          )}
        </Group>
      )}
    </div>
  )
}

function Changes({
  t,
  changes,
}: {
  readonly t: Translate
  readonly changes: readonly FileChange[]
}) {
  return (
    <>
      {changes
        .filter((change) => change.kind !== "same")
        .map((change) => (
          <Group
            key={change.path}
            title={change.path}
            tag={<Tag>{t(FILE_CHANGE[change.kind])}</Tag>}
          >
            <pre className="dshb-skills-diff" data-dshb-skill-diff={change.path}>
              {change.lines.map((line, index) => (
                <span key={index} className={`dshb-skills-line dshb-skills-line-${line.kind}`}>
                  {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
                  {line.text}
                  {"\n"}
                </span>
              ))}
            </pre>
          </Group>
        ))}
    </>
  )
}

function VersionPage(
  props: SettingsSectionProps &
    SkillsSectionDeps & { readonly name: string; readonly versionId: string },
) {
  const { t, bot, page, skills, name, versionId } = props
  const state = useObservable(
    useMemo(() => skillVersion(skills, bot.id, name, versionId), [skills, bot.id, name, versionId]),
  )
  const tab = useMemo(createVersionTab, [])
  const shownTab = useObservable(tab)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (state.status === "failed")
    return <ErrorText>{t("skills.loadFailed", { message: state.message })}</ErrorText>
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("skills.loading")} />
      </Group>
    )
  }
  const { version, changes, newest } = state.value
  const restore = async () => {
    const confirmed = await props.confirm({
      title: t("skills.restoreVersion.title", { name }),
      description: t("skills.restoreVersion.description", {
        at: localeFormat(t).instant(version.at, "dateTime"),
      }),
      confirm: t("skills.restoreVersion.confirm"),
      tone: "primary",
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await skills.restoreVersion(bot.id, name, version.id)
      page.open(skillDetail(name))
    } catch (cause) {
      setError(t("skills.restoreFailed", { message: messageOf(cause) }))
    } finally {
      setBusy(false)
    }
  }
  const changed = changes.filter((change) => change.kind !== "same")
  return (
    <div className="dshb-settings-groups" data-dshb-skill-version-page={version.id}>
      <PageTitle
        tag={<Tag>{t(OPERATION[version.operation])}</Tag>}
        trailing={
          <Button
            variant="secondary"
            disabled={busy || (newest && !version.archived)}
            onClick={() => void restore()}
            marks={{ "data-dshb-skill-restore-version": "" }}
          >
            {t("skills.restoreVersion")}
          </Button>
        }
      >
        {name}
      </PageTitle>
      <Group>
        <Row label={versionMeta(t, version)} />
      </Group>
      {error !== null && <ErrorText>{error}</ErrorText>}
      <Segmented<VersionTab>
        value={shownTab}
        label={t("skills.version.view")}
        choices={[
          { value: "changes", label: t("skills.version.changes") },
          { value: "content", label: t("skills.version.content") },
        ]}
        onChange={(value) => tab.set(value)}
        marks={{ "data-dshb-skill-tab": "" }}
      />
      {shownTab === "changes" ? (
        changed.length === 0 ? (
          <Group>
            <Row label={t("skills.version.unchanged")} />
          </Group>
        ) : (
          <Changes t={t} changes={changed} />
        )
      ) : (
        version.files.map((file) => (
          <Group key={file.path} title={file.path}>
            <pre className="dshb-skills-diff" data-dshb-skill-file={file.path}>
              {file.text}
            </pre>
          </Group>
        ))
      )}
    </div>
  )
}
