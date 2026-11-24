import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  type BotCreateInput,
  type BotCreationChoices,
  type BotCreationOffer,
  MAX_NAME_LENGTH,
} from "../shared/bots"
import type { BotCreationOption } from "../shared/connectors"
import {
  BOT_ENVIRONMENT_SPEC_KEYS,
  type BotEnvironmentCapacityShortfall,
  type BotEnvironmentSpec,
} from "../shared/environment"
import { type BotModelCatalog, type BotModelChoice, PROFILE_DEFAULT_MODEL } from "../shared/models"
import { Avatar } from "./Avatar"
import { AvatarPicker } from "./AvatarPicker"
import { type AvatarChoice, avatarOfChoice, decomposeAvatar } from "./avatar-data"
import {
  type CreationEnvironment,
  type CreationOfferState,
  creationEnvironment,
  initialChoices,
  noChoices,
  offeredOptions,
  optionFits,
} from "./creation-options"
import { ENVIRONMENT_KEY_LABEL, environmentValueText } from "./environment/labels"
import type { BotsFace } from "./face"
import { useObservable } from "./hooks"
import type { MessageKey } from "./i18n"
import { IconClose } from "./icons"
import { browserTimeZone } from "./locale-format"
import { ModelsError } from "./models/feed"
import { modelsFailureText } from "./models/labels"
import { ModelRoute } from "./models/ModelRoute"
import { modelMenu } from "./models/menu"
import { type CatalogState, catalogOf, useModelCatalog } from "./models/use-catalog"
import { timeZoneChoices } from "./time-zones"
import type { Translate } from "./types"
import { Button } from "./ui/Button"
import { ErrorText } from "./ui/EmptyState"
import { Group } from "./ui/Group"
import { useLayer } from "./ui/layers"
import { Row } from "./ui/Row"
import { SearchSelect } from "./ui/SearchSelect"
import { Switch } from "./ui/Switch"
import { TextInput } from "./ui/TextInput"

/** What the New bot dialog's overlay registration injects. */
export interface CreateBotFace extends Pick<BotsFace, "createBot" | "createDialog"> {
  /** The creation options offered; rejects when they cannot be read. */
  creationOptions(): Promise<BotCreationOffer>
  /** DSH's model catalog; rejects with a `ModelsError`. */
  modelCatalog(): Promise<BotModelCatalog>
}

interface CreateDialogProps extends CreateBotFace {
  t: Translate
}

/** The New bot dialog, rendered in the frame-wide `shell.overlay` layer like the host's dialogs. */
export function CreateBotDialog({
  t,
  createBot,
  createDialog,
  creationOptions,
  modelCatalog,
}: CreateDialogProps) {
  const open = useObservable(createDialog)
  if (!open) return null
  return (
    <BotDialog
      t={t}
      creationOptions={creationOptions}
      modelCatalog={modelCatalog}
      onSubmit={createBot}
      onClose={() => createDialog.set(false)}
      returnFocus="[data-dshb-new-bot]"
    />
  )
}

/** The creation options, read once when the dialog opens. */
function useCreationOffer(read: CreateBotFace["creationOptions"]): CreationOfferState {
  const [state, setState] = useState<CreationOfferState>({ status: "loading" })
  useEffect(() => {
    let current = true
    read().then(
      (offer) => {
        if (current) setState({ status: "ready", offer })
      },
      (error: unknown) => {
        if (current)
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      current = false
    }
  }, [read])
  return state
}

export interface BotDialogProps {
  t: Translate
  creationOptions: CreateBotFace["creationOptions"]
  modelCatalog: CreateBotFace["modelCatalog"]
  /**
   * Creates the bot. Resolves once the Host accepted it (it is prepared in the
   * background); a rejection is shown in the dialog and keeps it open.
   */
  onSubmit(input: Omit<BotCreateInput, "language">): Promise<void>
  /** Unmount the dialog; called on Cancel, ×, Escape, the mask, and after a successful submit. */
  onClose(): void
  /**
   * Selector of the element to focus once the dialog closes. Without it the
   * element focused when the dialog opened gets focus back.
   */
  returnFocus?: string
}

/** The New bot modal. Mount it only while open. */
export function BotDialog({
  t,
  creationOptions,
  modelCatalog,
  onSubmit,
  onClose,
  returnFocus,
}: BotDialogProps) {
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  )
  const [name, setName] = useState("")
  const [choice, setChoice] = useState<AvatarChoice>(() => decomposeAvatar(undefined))
  const offer = useCreationOffer(creationOptions)
  const [choices, setChoices] = useState<BotCreationChoices>(noChoices)
  useEffect(() => {
    if (offer.status === "ready") setChoices(initialChoices(offer.offer))
  }, [offer])
  const catalog = useModelCatalog(modelCatalog)
  const [main, setMain] = useState<BotModelChoice>(PROFILE_DEFAULT_MODEL)
  const [timezone, setTimezone] = useState(browserTimeZone)
  const zones = useMemo(() => timeZoneChoices(timezone), [timezone])
  const environment =
    offer.status === "ready" ? creationEnvironment(offer.offer, choices) : undefined
  const environmentBlocked =
    environment !== undefined && (environment.status === "unavailable" || !environment.ok)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const dialogRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const avatar = avatarOfChoice(choice, name)
  const trimmed = name.trim()
  const blocked = busy || trimmed.length === 0 || offer.status === "loading" || environmentBlocked

  const close = useCallback(() => onClose(), [onClose])
  useLayer(dialogRef, {
    active: true,
    trap: true,
    onEscape: close,
    restore: () =>
      returnFocus === undefined ? opener : document.querySelector<HTMLElement>(returnFocus),
  })

  const submit = async () => {
    if (blocked) return
    setBusy(true)
    setError(undefined)
    try {
      await onSubmit({ ...choices, name: trimmed, avatar, timezone, models: { main } })
      close()
    } catch (cause) {
      setError(
        cause instanceof ModelsError
          ? modelsFailureText(t, cause.failure)
          : t("error.generic", { message: cause instanceof Error ? cause.message : String(cause) }),
      )
      setBusy(false)
    }
  }

  const titleId = `${id}-title`
  const formId = `${id}-form`

  return (
    <div className="dshb-modal-root">
      <div className="dshb-modal-mask" aria-hidden="true" onClick={close} />
      <div
        ref={dialogRef}
        className="dshb-modal dshb-create"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-dshb-create-dialog=""
      >
        <div className="dshb-modal-header">
          <h2 id={titleId} className="dshb-modal-title">
            {t("section.new")}
          </h2>
          <Button variant="icon" label={t("form.close")} onClick={close}>
            <IconClose />
          </Button>
        </div>
        <form
          className="dshb-modal-body"
          id={formId}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="dshb-create-identity">
            <Avatar avatar={avatar} size={40} />
            <TextInput
              value={name}
              onChange={setName}
              label={t("form.name")}
              placeholder={t("form.namePlaceholder")}
              maxLength={MAX_NAME_LENGTH}
              disabled={busy}
              autoFocus
              marks={{ "data-dshb-create-name": "" }}
            />
          </div>
          <AvatarPicker t={t} name={name} value={choice} onChange={setChoice} disabled={busy} />
          <MainModel t={t} catalog={catalog} value={main} disabled={busy} onChange={setMain} />
          <Group>
            <Row
              label={t("form.timezone")}
              trailing={
                <SearchSelect
                  t={t}
                  value={timezone}
                  choices={zones}
                  onChange={setTimezone}
                  label={t("form.timezone")}
                  disabled={busy}
                  marks={{ "data-dshb-create-timezone": "" }}
                />
              }
            />
          </Group>
          <CreationOptions
            t={t}
            state={offer}
            choices={choices}
            environment={environment}
            disabled={busy}
            onChange={(option, on) => setChoices({ ...choices, [option]: on })}
          />
          {error !== undefined && <ErrorText>{error}</ErrorText>}
        </form>
        <div className="dshb-modal-footer">
          <Button variant="secondary" onClick={close}>
            {t("form.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={blocked}
            marks={{ "data-dshb-create-submit": "" }}
          >
            {busy ? t("form.creating") : t("form.create")}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface MainModelProps {
  readonly t: Translate
  readonly catalog: CatalogState
  readonly value: BotModelChoice
  readonly disabled: boolean
  onChange(choice: BotModelChoice): void
}

/** The new bot's main model, DSH's default until another is picked. */
function MainModel({ t, catalog, value, disabled, onChange }: MainModelProps) {
  const read = catalogOf(catalog)
  const menu = useMemo(() => modelMenu(read, [value]), [read, value])
  const label = t("form.model")
  return (
    <>
      <Group>
        <Row
          label={label}
          marks={{ "data-dshb-create-model": "" }}
          trailing={
            <ModelRoute
              t={t}
              menu={menu}
              value={value}
              label={label}
              disabled={disabled || read === undefined}
              onChange={onChange}
            />
          }
        />
      </Group>
      {catalog.status === "failed" && (
        <ErrorText>{t("models.catalogFailed", { message: catalog.failure.message })}</ErrorText>
      )}
    </>
  )
}

const OPTION_LABEL: { readonly [Option in BotCreationOption]: MessageKey } = {
  workstation: "form.workstation",
}

interface CreationOptionsProps {
  readonly t: Translate
  readonly state: CreationOfferState
  readonly choices: BotCreationChoices
  readonly environment: CreationEnvironment | undefined
  readonly disabled: boolean
  onChange(option: BotCreationOption, on: boolean): void
}

/** One switch row per creation option some registered connector belongs to, then the VM they get. */
function CreationOptions({
  t,
  state,
  choices,
  environment,
  disabled,
  onChange,
}: CreationOptionsProps) {
  if (state.status === "loading") return null
  if (state.status === "failed") {
    return <ErrorText>{t("form.optionsFailed", { message: state.message })}</ErrorText>
  }
  const offer = state.offer
  const options = offeredOptions(offer)
  const planned = environment?.status === "planned" && environment.ok ? environment.spec : undefined
  return (
    <>
      {(options.length > 0 || planned !== undefined) && (
        <Group>
          {options.map((option) => {
            const label = t(OPTION_LABEL[option])
            const fits = optionFits(offer, option)
            const tooLarge = offer.capacity.status === "ready" && !fits
            return (
              <Row
                key={option}
                label={label}
                meta={tooLarge ? t("form.optionTooLarge") : undefined}
                marks={{ "data-dshb-creation-option": option }}
                trailing={
                  <Switch
                    checked={choices[option]}
                    label={label}
                    disabled={disabled || (!fits && !choices[option])}
                    onChange={(on) => onChange(option, on)}
                    marks={{ "data-dshb-creation-switch": option }}
                  />
                }
              />
            )
          })}
          {planned !== undefined && (
            <Row
              label={t("form.vm")}
              meta={t("form.vmLater")}
              marks={{ "data-dshb-create-vm": "" }}
              trailing={<span className="dshb-create-vm-spec">{specText(t, planned)}</span>}
            />
          )}
        </Group>
      )}
      {environment?.status === "unavailable" && (
        <ErrorText>{t("form.vmUnavailable", { message: environment.reason })}</ErrorText>
      )}
      {environment?.status === "planned" &&
        !environment.ok &&
        environment.shortfalls.map((shortfall) => (
          <ErrorText key={shortfall.key}>{shortfallText(t, shortfall)}</ErrorText>
        ))}
    </>
  )
}

function specText(t: Translate, spec: BotEnvironmentSpec): string {
  return BOT_ENVIRONMENT_SPEC_KEYS.map((key) => environmentValueText(t, key, spec[key])).join(" · ")
}

function shortfallText(t: Translate, shortfall: BotEnvironmentCapacityShortfall): string {
  const params = {
    resource: t(ENVIRONMENT_KEY_LABEL[shortfall.key]),
    need: environmentValueText(t, shortfall.key, shortfall.need),
    available: environmentValueText(t, shortfall.key, shortfall.available),
    connectors: shortfall.connectors.join(", "),
  }
  return shortfall.connectors.length === 0
    ? t("form.vmShortfall", params)
    : t("form.vmShortfallConnectors", params)
}
