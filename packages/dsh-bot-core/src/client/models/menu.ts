import {
  type BotModelCatalog,
  type BotModelChoice,
  type BotModelOffer,
  type BotModelSelection,
  PROFILE_DEFAULT_MODEL,
  sameModelChoice,
} from "../../shared/models"

export interface NamedId {
  readonly id: string
  readonly name: string
}

/**
 * One entry of a model picker: DSH's default, or one model of a provider.
 * A fixed entry without `offer` is a stored route the catalog does not list.
 */
export type ModelOption =
  | { readonly key: string; readonly kind: "profile-default" }
  | {
      readonly key: string
      readonly kind: "fixed"
      readonly provider: NamedId
      readonly model: NamedId
      readonly offer?: BotModelOffer
    }

export type FixedModelOption = Extract<ModelOption, { kind: "fixed" }>

/** DSH's default model now, with its names when the catalog lists it. */
export interface ProfileDefaultRoute {
  readonly selection: BotModelSelection
  readonly provider: NamedId
  readonly model: NamedId
}

/** What a model picker offers: DSH's default, the catalog's models, then stored routes it does not list. */
export interface ModelMenu {
  /** Whether the catalog was read; until then only stored routes are known, by their ids. */
  readonly listed: boolean
  readonly profileDefault: ProfileDefaultRoute | undefined
  readonly options: readonly ModelOption[]
  find(key: string): ModelOption | undefined
  /** The entry of a choice's route (its effort aside). */
  optionOf(choice: BotModelChoice): ModelOption
}

const PROFILE_DEFAULT_KEY = "profile-default"

const sameRoute = (option: ModelOption, choice: BotModelChoice): boolean =>
  choice.kind === "profile-default"
    ? option.kind === "profile-default"
    : option.kind === "fixed" &&
      option.provider.id === choice.provider &&
      option.model.id === choice.model

function profileDefaultOf(catalog: BotModelCatalog): ProfileDefaultRoute {
  const { profileDefault } = catalog
  const provider = catalog.providers.find((offer) => offer.id === profileDefault.provider)
  const model = provider?.models.find((offer) => offer.id === profileDefault.model)
  return {
    selection: profileDefault,
    provider: { id: profileDefault.provider, name: provider?.name ?? profileDefault.provider },
    model: { id: profileDefault.model, name: model?.name ?? profileDefault.model },
  }
}

/** The picker over `catalog` (absent while unread) that can also show every `stored` choice. */
export function modelMenu(
  catalog: BotModelCatalog | undefined,
  stored: readonly BotModelChoice[],
): ModelMenu {
  const options: ModelOption[] = [{ key: PROFILE_DEFAULT_KEY, kind: "profile-default" }]
  const add = (option: Omit<FixedModelOption, "key">) =>
    options.push({ ...option, key: `model:${options.length}` })
  for (const provider of catalog?.providers ?? []) {
    for (const offer of provider.models) {
      add({
        kind: "fixed",
        provider: { id: provider.id, name: provider.name },
        model: { id: offer.id, name: offer.name },
        offer,
      })
    }
  }
  for (const choice of stored) {
    if (choice.kind === "profile-default" || options.some((option) => sameRoute(option, choice))) {
      continue
    }
    const provider = catalog?.providers.find((offer) => offer.id === choice.provider)
    add({
      kind: "fixed",
      provider: { id: choice.provider, name: provider?.name ?? choice.provider },
      model: { id: choice.model, name: choice.model },
    })
  }
  const byKey = new Map(options.map((option) => [option.key, option]))
  return {
    listed: catalog !== undefined,
    profileDefault: catalog === undefined ? undefined : profileDefaultOf(catalog),
    options,
    find: (key) => byKey.get(key),
    optionOf(choice) {
      const found = options.find((option) => sameRoute(option, choice))
      if (found === undefined) throw new Error("bot-core: a model choice outside its menu")
      return found
    },
  }
}

/** A stored route the read catalog does not list: DSH cannot run it now. */
export const unlisted = (menu: ModelMenu, option: ModelOption): boolean =>
  menu.listed && option.kind === "fixed" && option.offer === undefined

/** The value of an effort picker that follows the provider's default (no `reasoningEffort`). */
export const DEFAULT_EFFORT = ""

export interface EffortOption {
  readonly value: string
  /** The effort's name; absent for {@link DEFAULT_EFFORT} and for a stored effort the model does not offer. */
  readonly name?: string
}

/**
 * The efforts a choice of `option` may take, its provider's default first,
 * with a stored effort the model no longer offers; none for a model without
 * efforts (or DSH's default, whose effort is DSH's).
 */
export function effortOptions(
  option: ModelOption,
  current: string | undefined,
): readonly EffortOption[] {
  if (option.kind === "profile-default") return []
  const offered = option.offer?.reasoning?.efforts ?? []
  const listed: EffortOption[] = offered.map((effort) => ({ value: effort.id, name: effort.name }))
  if (current !== undefined && !offered.some((effort) => effort.id === current)) {
    listed.push({ value: current })
  }
  return listed.length === 0 ? [] : [{ value: DEFAULT_EFFORT }, ...listed]
}

/** The name of the provider's default effort of `option`, when it names one. */
export function defaultEffortName(option: ModelOption): string | undefined {
  if (option.kind === "profile-default") return undefined
  const reasoning = option.offer?.reasoning
  return reasoning?.efforts.find((effort) => effort.id === reasoning.defaultEffort)?.name
}

/** The choice of `option` at `effort` ({@link DEFAULT_EFFORT}: the provider's). */
export function choiceOf(option: ModelOption, effort: string = DEFAULT_EFFORT): BotModelChoice {
  if (option.kind === "profile-default") return PROFILE_DEFAULT_MODEL
  return {
    kind: "fixed",
    provider: option.provider.id,
    model: option.model.id,
    ...(effort === DEFAULT_EFFORT ? {} : { reasoningEffort: effort }),
  }
}

export const effortOf = (choice: BotModelChoice): string =>
  choice.kind === "fixed" ? (choice.reasoningEffort ?? DEFAULT_EFFORT) : DEFAULT_EFFORT

/** Whether `list` holds `choice` anywhere but at `except`. */
export const holds = (
  list: readonly BotModelChoice[],
  choice: BotModelChoice,
  except?: number,
): boolean => list.some((item, index) => index !== except && sameModelChoice(item, choice))
