import { useMemo } from "react"
import { MAX_NAME_LENGTH } from "../../shared/bots"
import type { BotChannelText } from "../../shared/channels"
import type { BotCreationOption } from "../../shared/connectors"
import {
  BOT_ENVIRONMENT_SPEC_KEYS,
  type BotEnvironmentCapacityShortfall,
  type BotEnvironmentSpec,
} from "../../shared/environment"
import type { BotModelChoice } from "../../shared/models"
import { Avatar } from "../Avatar"
import { AvatarPicker } from "../AvatarPicker"
import {
  type CreationEnvironment,
  type CreationOfferState,
  offeredOptions,
  optionFits,
} from "../creation-options"
import { ENVIRONMENT_KEY_LABEL, environmentValueText } from "../environment/labels"
import type { MessageKey } from "../i18n"
import { ModelRoute } from "../models/ModelRoute"
import { modelMenu } from "../models/menu"
import { type CatalogState, catalogOf } from "../models/use-catalog"
import type { Translate } from "../types"
import { ErrorText } from "../ui/EmptyState"
import { Group } from "../ui/Group"
import { Row } from "../ui/Row"
import { SearchSelect } from "../ui/SearchSelect"
import { Switch } from "../ui/Switch"
import { TextInput } from "../ui/TextInput"
import type { BotCreationForm } from "./use-creation-form"

export function BotCreationFields({
  t,
  text,
  form,
  autoFocus,
}: {
  readonly t: Translate
  text(text: BotChannelText): string
  readonly form: BotCreationForm
  readonly autoFocus: boolean
}) {
  const { busy } = form
  return (
    <>
      <div className="dshb-create-identity">
        <Avatar avatar={form.avatar} size={40} />
        <TextInput
          value={form.name}
          onChange={form.setName}
          label={t("form.name")}
          placeholder={t("form.namePlaceholder")}
          maxLength={MAX_NAME_LENGTH}
          disabled={busy}
          autoFocus={autoFocus}
          marks={{ "data-dshb-create-name": "" }}
        />
      </div>
      <AvatarPicker
        t={t}
        name={form.name}
        value={form.avatarChoice}
        onChange={form.setAvatarChoice}
        disabled={busy}
      />
      <MainModel
        t={t}
        catalog={form.catalog}
        value={form.main}
        disabled={busy}
        onChange={form.setMain}
      />
      <Group>
        <Row
          label={t("form.timezone")}
          trailing={
            <SearchSelect
              t={t}
              value={form.timezone}
              choices={form.zones}
              onChange={form.setTimezone}
              label={t("form.timezone")}
              disabled={busy}
              marks={{ "data-dshb-create-timezone": "" }}
            />
          }
        />
      </Group>
      <CreationOptions
        t={t}
        state={form.offer}
        choices={form.choices}
        environment={form.environment}
        disabled={busy}
        onChange={form.setOption}
      />
      <ChannelDefaults t={t} form={form} text={text} disabled={busy} />
      {form.error !== undefined && <ErrorText>{form.error}</ErrorText>}
    </>
  )
}

interface MainModelProps {
  readonly t: Translate
  readonly catalog: CatalogState
  readonly value: BotModelChoice
  readonly disabled: boolean
  onChange(choice: BotModelChoice): void
}

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
  readonly choices: BotCreationForm["choices"]
  readonly environment: CreationEnvironment | undefined
  readonly disabled: boolean
  onChange(option: BotCreationOption, on: boolean): void
}

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
      {environment?.status === "full" && (
        <ErrorText>{t("form.vmFull", { message: environment.reason })}</ErrorText>
      )}
      {environment?.status === "planned" &&
        !environment.ok &&
        environment.shortfalls.map((shortfall) => (
          <ErrorText key={shortfall.key}>{shortfallText(t, shortfall)}</ErrorText>
        ))}
    </>
  )
}

function ChannelDefaults(props: {
  readonly t: Translate
  text(text: BotChannelText): string
  readonly form: BotCreationForm
  readonly disabled: boolean
}) {
  const { t, text, form } = props
  const { defaults } = form
  if (defaults.status === "loading") return null
  if (defaults.status === "failed") {
    return <ErrorText>{t("form.channelsFailed", { message: defaults.message })}</ErrorText>
  }
  if (defaults.defaults.length === 0) return null
  return (
    <Group title={t("form.channels")}>
      {defaults.defaults.map((offer) => {
        const ready = offer.initial.state === "ready"
        const label = ready
          ? t("form.channelOn", { channel: offer.name, summary: text(offer.initial.summary) })
          : offer.name
        return (
          <Row
            key={offer.channelId}
            label={label}
            meta={offer.initial.state === "unavailable" ? text(offer.initial.reason) : undefined}
            metaTone={ready ? undefined : "warning"}
            marks={{ "data-dshb-create-channel": offer.channelId }}
            trailing={
              <Switch
                checked={ready && form.channels.includes(offer.channelId)}
                label={label}
                disabled={props.disabled || !ready}
                onChange={(on) => form.setChannel(offer.channelId, on)}
                marks={{ "data-dshb-create-channel-switch": offer.channelId }}
              />
            }
          />
        )
      })}
    </Group>
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
