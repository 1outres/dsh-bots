import type { BotCreationChoices, BotCreationOffer } from "../shared/bots"
import { BOT_CREATION_OPTIONS, type BotCreationOption } from "../shared/connectors"
import {
  type BotEnvironmentNeed,
  type InitialEnvironmentSpec,
  initialEnvironmentSpec,
} from "../shared/environment"

/** The creation options the New bot dialog offers, as far as they were read. */
export type CreationOfferState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly offer: BotCreationOffer }
  | { readonly status: "failed"; readonly message: string }

/** The VM a creation with some choices gets, as the Host makes it (`initialEnvironmentSpec`). */
export type CreationEnvironment =
  | { readonly status: "unavailable"; readonly reason: string }
  | ({ readonly status: "planned" } & InitialEnvironmentSpec)

/** How an offered option starts before the creator chooses. */
const STARTS_ON: { readonly [Option in BotCreationOption]: boolean } = { workstation: true }

/** The options offered, in their order. */
export function offeredOptions(offer: BotCreationOffer): BotCreationOption[] {
  return BOT_CREATION_OPTIONS.filter((option) => offer.options.some((o) => o.option === option))
}

/** What the connectors of the options on need of the bot's VM. */
function needsOf(offer: BotCreationOffer, on: (option: BotCreationOption) => boolean) {
  return offer.options.flatMap((offered): readonly BotEnvironmentNeed[] =>
    on(offered.option) ? offered.needs : [],
  )
}

export function creationEnvironment(
  offer: BotCreationOffer,
  choices: BotCreationChoices,
): CreationEnvironment {
  if (offer.capacity.status === "unavailable") {
    return { status: "unavailable", reason: offer.capacity.reason }
  }
  return {
    status: "planned",
    ...initialEnvironmentSpec(
      offer.capacity.capacity,
      needsOf(offer, (option) => choices[option]),
    ),
  }
}

/** Whether the Host can give a bot's VM what the option needs, alone. */
export function optionFits(offer: BotCreationOffer, option: BotCreationOption): boolean {
  if (offer.capacity.status === "unavailable") return false
  return initialEnvironmentSpec(
    offer.capacity.capacity,
    needsOf(offer, (offered) => offered === option),
  ).ok
}

/** Every option off: what a bot is created with while none is offered. */
export function noChoices(): BotCreationChoices {
  return choicesOf(() => false)
}

/** Each offered option that fits as it starts, every other one off. */
export function initialChoices(offer: BotCreationOffer): BotCreationChoices {
  return choicesOf(
    (option) =>
      offeredOptions(offer).includes(option) && STARTS_ON[option] && optionFits(offer, option),
  )
}

function choicesOf(chosen: (option: BotCreationOption) => boolean): BotCreationChoices {
  return Object.fromEntries(
    BOT_CREATION_OPTIONS.map((option) => [option, chosen(option)]),
  ) as BotCreationChoices
}
