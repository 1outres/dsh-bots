import { useCallback, useEffect, useMemo, useState } from "react"
import type { BotAvatar } from "../../shared/avatar"
import type { BotCreationChoices, BotCreationOffer } from "../../shared/bots"
import type { BotChannelDefault } from "../../shared/channels"
import type { BotCreationOption } from "../../shared/connectors"
import {
  type BotModelCatalog,
  type BotModelChoice,
  PROFILE_DEFAULT_MODEL,
} from "../../shared/models"
import { type AvatarChoice, avatarOfChoice, DEFAULT_AVATAR_CHOICE } from "../avatar-data"
import {
  type CreationEnvironment,
  type CreationOfferState,
  creationEnvironment,
  initialChoices,
  noChoices,
} from "../creation-options"
import { browserTimeZone } from "../locale-format"
import { ModelsError } from "../models/feed"
import { modelsFailureText } from "../models/labels"
import { type CatalogState, useModelCatalog } from "../models/use-catalog"
import { timeZoneChoices } from "../time-zones"
import type { Translate } from "../types"
import type { Choice } from "../ui/choices"
import type { BotCreationRequest } from "./request"

export interface CreationSources {
  creationOptions(): Promise<BotCreationOffer>
  modelCatalog(): Promise<BotModelCatalog>
  channelDefaults(): Promise<readonly BotChannelDefault[]>
}

export type ChannelDefaultsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly defaults: readonly BotChannelDefault[] }
  | { readonly status: "failed"; readonly message: string }

export interface BotCreationForm {
  readonly name: string
  setName(name: string): void
  readonly avatarChoice: AvatarChoice
  setAvatarChoice(choice: AvatarChoice): void
  readonly avatar: BotAvatar
  readonly offer: CreationOfferState
  reloadOffer(): void
  readonly choices: BotCreationChoices
  setOption(option: BotCreationOption, on: boolean): void
  readonly defaults: ChannelDefaultsState
  readonly channels: readonly string[]
  setChannel(channelId: string, on: boolean): void
  readonly catalog: CatalogState
  readonly main: BotModelChoice
  setMain(choice: BotModelChoice): void
  readonly timezone: string
  setTimezone(zone: string): void
  readonly zones: readonly Choice<string>[]
  readonly environment: CreationEnvironment | undefined
  readonly busy: boolean
  readonly error: string | undefined
  readonly blocked: boolean
  submit(send: (request: BotCreationRequest) => Promise<void>): Promise<boolean>
}

function useCreationOffer(read: CreationSources["creationOptions"]) {
  const [state, setState] = useState<CreationOfferState>({ status: "loading" })
  const [reads, setReads] = useState(0)
  useEffect(() => {
    let current = true
    if (reads > 0) setState({ status: "loading" })
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
  }, [read, reads])
  const reload = useCallback(() => setReads((count) => count + 1), [])
  return [state, reload] as const
}

function useChannelDefaults(read: CreationSources["channelDefaults"]) {
  const [state, setState] = useState<ChannelDefaultsState>({ status: "loading" })
  useEffect(() => {
    let current = true
    read().then(
      (defaults) => {
        if (current) setState({ status: "ready", defaults })
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

const offeredChannels = (state: ChannelDefaultsState): readonly string[] =>
  state.status === "ready"
    ? state.defaults
        .filter((offer) => offer.initial.state === "ready")
        .map((offer) => offer.channelId)
    : []

export function useBotCreationForm(t: Translate, sources: CreationSources): BotCreationForm {
  const [name, setName] = useState("")
  const [avatarChoice, setAvatarChoice] = useState<AvatarChoice>(DEFAULT_AVATAR_CHOICE)
  const [offer, reloadOffer] = useCreationOffer(sources.creationOptions)
  const [choices, setChoices] = useState<BotCreationChoices>(noChoices)
  useEffect(() => {
    if (offer.status === "ready") setChoices(initialChoices(offer.offer))
  }, [offer])
  const defaults = useChannelDefaults(sources.channelDefaults)
  const [channels, setChannels] = useState<readonly string[]>([])
  useEffect(() => {
    setChannels(offeredChannels(defaults))
  }, [defaults])
  const catalog = useModelCatalog(sources.modelCatalog)
  const [main, setMain] = useState<BotModelChoice>(PROFILE_DEFAULT_MODEL)
  const [timezone, setTimezone] = useState(browserTimeZone)
  const zones = useMemo(() => timeZoneChoices(timezone), [timezone])
  const environment =
    offer.status === "ready" ? creationEnvironment(offer.offer, choices) : undefined
  const environmentBlocked =
    environment !== undefined && (environment.status !== "planned" || !environment.ok)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const avatar = avatarOfChoice(avatarChoice, name)
  const trimmed = name.trim()
  const blocked = busy || trimmed.length === 0 || offer.status === "loading" || environmentBlocked

  const submit = async (send: (request: BotCreationRequest) => Promise<void>) => {
    if (blocked) return false
    setBusy(true)
    setError(undefined)
    try {
      await send({ ...choices, name: trimmed, avatar, timezone, models: { main }, channels })
      return true
    } catch (cause) {
      setError(
        cause instanceof ModelsError
          ? modelsFailureText(t, cause.failure)
          : t("error.generic", { message: cause instanceof Error ? cause.message : String(cause) }),
      )
      setBusy(false)
      return false
    }
  }

  return {
    name,
    setName,
    avatarChoice,
    setAvatarChoice,
    avatar,
    offer,
    reloadOffer,
    choices,
    setOption: (option, on) => setChoices({ ...choices, [option]: on }),
    defaults,
    channels,
    setChannel: (channelId, on) =>
      setChannels(
        on
          ? [...new Set([...channels, channelId])]
          : channels.filter((listed) => listed !== channelId),
      ),
    catalog,
    main,
    setMain,
    timezone,
    setTimezone,
    zones,
    environment,
    busy,
    error,
    blocked,
    submit,
  }
}
