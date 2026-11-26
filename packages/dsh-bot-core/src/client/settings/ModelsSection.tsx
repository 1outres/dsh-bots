import { useMemo, useState } from "react"
import {
  type BotModelCatalog,
  type BotModelChoice,
  type BotModelSettings,
  type BotModelSingleRole,
  type BotModelsView,
  PROFILE_DEFAULT_MODEL,
  sameModelChoice,
} from "../../shared/models"
import { useObservable } from "../hooks"
import type { MessageKey } from "../i18n"
import { IconCheck, IconClose } from "../icons"
import type { ModelsFeed, ModelsHub } from "../models/feed"
import { effortChoices, modelsFailureText, optionLabel, optionProvider } from "../models/labels"
import { appended, itemKey, moved, removed, replaced } from "../models/list"
import { ModelRoute } from "../models/ModelRoute"
import { choiceOf, effortOf, holds, type ModelMenu, modelMenu, unlisted } from "../models/menu"
import { type CatalogState, catalogOf, useModelCatalog } from "../models/use-catalog"
import { type RoleFailure, useRoleSave } from "../models/use-role-save"
import type { Translate } from "../types"
import { AddRow, BlockRow, Button, ErrorText, Group, Row, RowMenu, Select, StatusPill } from "../ui"
import type { SettingsSectionProps } from "./sections"

export interface ModelsSectionDeps {
  readonly models: ModelsHub
  readCatalog(): Promise<BotModelCatalog>
}

const ROLE_LABEL: { readonly [Role in BotModelSingleRole]: MessageKey } = {
  main: "models.role.main",
  utility: "models.role.utility",
}

const SINGLE_ROLES: readonly BotModelSingleRole[] = ["main", "utility"]

export function ModelsSection({
  t,
  bot,
  models,
  readCatalog,
}: SettingsSectionProps & ModelsSectionDeps) {
  const feed = models.feed(bot.id)
  const state = useObservable(feed)
  const catalog = useModelCatalog(readCatalog)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("models.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return (
      <ErrorText>
        {t("models.unavailable", { message: modelsFailureText(t, state.failure) })}
      </ErrorText>
    )
  }
  return <ModelsBody t={t} feed={feed} view={state.view} catalog={catalog} />
}

interface BodyProps {
  readonly t: Translate
  readonly feed: ModelsFeed
  readonly view: BotModelsView
  readonly catalog: CatalogState
}

const storedChoices = (settings: BotModelSettings): readonly BotModelChoice[] => [
  settings.main,
  settings.utility,
  ...settings.delegates,
]

function ModelsBody({ t, feed, view, catalog }: BodyProps) {
  const settings = view.models
  const read = catalogOf(catalog)
  const menu = useMemo(() => modelMenu(read, storedChoices(settings)), [read, settings])
  const locked = read === undefined
  return (
    <div className="dshb-settings-groups" data-dshb-models="">
      <Group>
        {SINGLE_ROLES.map((role) => (
          <RoleRow
            key={role}
            t={t}
            feed={feed}
            role={role}
            value={settings[role]}
            menu={menu}
            locked={locked}
            pending={role === "main" && view.mainPending}
          />
        ))}
      </Group>
      <Delegates t={t} feed={feed} list={settings.delegates} menu={menu} locked={locked} />
      <CatalogProblems t={t} catalog={catalog} />
    </div>
  )
}

function CatalogProblems({
  t,
  catalog,
}: {
  readonly t: Translate
  readonly catalog: CatalogState
}) {
  if (catalog.status === "failed") {
    return <ErrorText>{t("models.catalogFailed", { message: catalog.failure.message })}</ErrorText>
  }
  if (catalog.status !== "ready") return null
  return (
    <>
      {catalog.catalog.failures.map((failure) => (
        <ErrorText key={failure.id}>
          {t("models.providerFailed", { provider: failure.name, message: failure.message })}
        </ErrorText>
      ))}
    </>
  )
}

const failureMeta = (t: Translate, failure: RoleFailure | null) =>
  failure === null ? undefined : modelsFailureText(t, failure.failure)

function UnlistedPill({ t }: { readonly t: Translate }) {
  return (
    <StatusPill
      tone="warning"
      label={t("models.unlisted")}
      marks={{ "data-dshb-model-unlisted": "" }}
    />
  )
}

interface RoleRowProps {
  readonly t: Translate
  readonly feed: ModelsFeed
  readonly role: BotModelSingleRole
  readonly value: BotModelChoice
  readonly menu: ModelMenu
  readonly locked: boolean
  readonly pending: boolean
}

function RoleRow({ t, feed, role, value, menu, locked, pending }: RoleRowProps) {
  const save = useRoleSave(feed.configure)
  const label = t(ROLE_LABEL[role])
  const option = menu.optionOf(value)
  const error = failureMeta(t, save.failure)
  return (
    <Row
      label={label}
      meta={error ?? optionProvider(menu, option)}
      metaTone={error === undefined ? undefined : "danger"}
      marks={{ "data-dshb-model-role": role }}
      trailing={
        <>
          {pending && (
            <StatusPill
              tone="idle"
              label={t("models.mainPending")}
              marks={{ "data-dshb-model-pending": "" }}
            />
          )}
          {unlisted(menu, option) && <UnlistedPill t={t} />}
          <ModelRoute
            t={t}
            menu={menu}
            value={value}
            label={label}
            disabled={locked || save.busy}
            onChange={(choice) => {
              if (!sameModelChoice(choice, value)) void save.run({ [role]: choice })
            }}
          />
        </>
      }
    />
  )
}

interface DelegatesProps {
  readonly t: Translate
  readonly feed: ModelsFeed
  readonly list: readonly BotModelChoice[]
  readonly menu: ModelMenu
  readonly locked: boolean
}

function Delegates({ t, feed, list, menu, locked }: DelegatesProps) {
  const save = useRoleSave(feed.configure)
  const [draft, setDraft] = useState<BotModelChoice | null>(null)
  const disabled = locked || save.busy
  const store = (next: readonly BotModelChoice[]) => save.run({ delegates: next })
  const subject = save.failure?.subject
  const onRow =
    subject === undefined ? -1 : list.findIndex((item) => sameModelChoice(item, subject))
  const onDraft = onRow === -1 && draft !== null && save.failure !== null
  const firstFree = () =>
    menu.options.map((option) => choiceOf(option)).find((choice) => !holds(list, choice)) ??
    PROFILE_DEFAULT_MODEL
  return (
    <>
      <Group title={t("models.delegates")} marks={{ "data-dshb-model-delegates": "" }}>
        {list.map((choice, index) => (
          <DelegateRow
            key={itemKey(choice)}
            t={t}
            menu={menu}
            list={list}
            index={index}
            disabled={disabled}
            error={onRow === index ? failureMeta(t, save.failure) : undefined}
            store={(next) => void store(next)}
          />
        ))}
        {draft === null ? (
          <AddRow
            label={t("models.delegates.add")}
            disabled={disabled}
            onAdd={() => setDraft(firstFree())}
            marks={{ "data-dshb-model-delegate-add": "" }}
          />
        ) : (
          <DraftRow
            t={t}
            menu={menu}
            list={list}
            draft={draft}
            disabled={disabled}
            error={onDraft ? failureMeta(t, save.failure) : undefined}
            onDraft={setDraft}
            onCancel={() => setDraft(null)}
            onAdd={() =>
              void store(appended(list, draft)).then((stored) => {
                if (stored) setDraft(null)
              })
            }
          />
        )}
      </Group>
      {onRow === -1 && !onDraft && save.failure !== null && (
        <ErrorText>{modelsFailureText(t, save.failure.failure)}</ErrorText>
      )}
    </>
  )
}

interface DelegateRowProps {
  readonly t: Translate
  readonly menu: ModelMenu
  readonly list: readonly BotModelChoice[]
  readonly index: number
  readonly disabled: boolean
  readonly error: string | undefined
  store(next: readonly BotModelChoice[]): void
}

function DelegateRow({ t, menu, list, index, disabled, error, store }: DelegateRowProps) {
  const choice = list[index]
  if (choice === undefined) return null
  const option = menu.optionOf(choice)
  const label = optionLabel(t, menu, option)
  const efforts = effortChoices(
    t,
    option,
    choice.kind === "fixed" ? choice.reasoningEffort : undefined,
    (effort) => holds(list, choiceOf(option, effort), index),
  )
  const up = moved(list, index, -1)
  const down = moved(list, index, 1)
  return (
    <Row
      label={label}
      meta={error ?? optionProvider(menu, option)}
      metaTone={error === undefined ? undefined : "danger"}
      marks={{ "data-dshb-model-delegate": String(index) }}
      trailing={
        <>
          {unlisted(menu, option) && <UnlistedPill t={t} />}
          {efforts.length > 0 && (
            <Select
              value={effortOf(choice)}
              choices={efforts}
              onChange={(effort) => store(replaced(list, index, choiceOf(option, effort)))}
              label={t("models.effortOf", { model: label })}
              disabled={disabled}
              marks={{ "data-dshb-model-effort": "" }}
            />
          )}
          <RowMenu
            label={t("models.delegates.more", { model: label })}
            disabled={disabled}
            items={[
              {
                id: "up",
                label: t("models.delegates.moveUp"),
                disabled: up === undefined,
                run: () => up !== undefined && store(up),
              },
              {
                id: "down",
                label: t("models.delegates.moveDown"),
                disabled: down === undefined,
                run: () => down !== undefined && store(down),
              },
              {
                id: "remove",
                label: t("models.delegates.remove"),
                tone: "danger",
                run: () => store(removed(list, index)),
              },
            ]}
            marks={{ "data-dshb-model-delegate-menu": "" }}
          />
        </>
      }
    />
  )
}

interface DraftRowProps {
  readonly t: Translate
  readonly menu: ModelMenu
  readonly list: readonly BotModelChoice[]
  readonly draft: BotModelChoice
  readonly disabled: boolean
  readonly error: string | undefined
  onDraft(choice: BotModelChoice): void
  onCancel(): void
  onAdd(): void
}

function DraftRow({
  t,
  menu,
  list,
  draft,
  disabled,
  error,
  onDraft,
  onCancel,
  onAdd,
}: DraftRowProps) {
  const label = t("models.delegates.add")
  const option = menu.optionOf(draft)
  return (
    <BlockRow
      label={label}
      meta={error}
      metaTone={error === undefined ? undefined : "danger"}
      marks={{ "data-dshb-model-delegate-draft": "" }}
      trailing={
        <>
          <Button
            variant="icon"
            label={t("models.delegates.confirm")}
            disabled={disabled || holds(list, draft)}
            onClick={onAdd}
            marks={{ "data-dshb-model-delegate-confirm": "" }}
          >
            <IconCheck size={14} />
          </Button>
          <Button variant="icon" label={t("form.cancel")} onClick={onCancel}>
            <IconClose size={14} />
          </Button>
        </>
      }
    >
      <ModelRoute
        t={t}
        menu={menu}
        value={draft}
        label={label}
        disabled={disabled}
        onChange={onDraft}
        effortTaken={(effort) => holds(list, choiceOf(option, effort))}
      />
    </BlockRow>
  )
}
