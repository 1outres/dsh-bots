import type { BotCreationChoices, BotCreationOffer } from "../shared/bots"
import { BOT_CREATION_OPTIONS, type BotCreationOption } from "../shared/connectors"
import {
  type BotEnvironmentNeed,
  type InitialEnvironmentSpec,
  initialEnvironmentSpec,
} from "../shared/environment"

export type CreationOfferState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly offer: BotCreationOffer }
  | { readonly status: "failed"; readonly message: string }

export type CreationEnvironment =
  | { readonly status: "unavailable" | "full"; readonly reason: string }
  | ({ readonly status: "planned" } & InitialEnvironmentSpec)

const STARTS_ON: { readonly [Option in BotCreationOption]: boolean } = { workstation: true }

export function offeredOptions(offer: BotCreationOffer): BotCreationOption[] {
  return BOT_CREATION_OPTIONS.filter((option) => offer.options.some((o) => o.option === option))
}

function needsOf(offer: BotCreationOffer, on: (option: BotCreationOption) => boolean) {
  return offer.options.flatMap((offered): readonly BotEnvironmentNeed[] =>
    on(offered.option) ? offered.needs : [],
  )
}

export function creationEnvironment(
  offer: BotCreationOffer,
  choices: BotCreationChoices,
): CreationEnvironment {
  if (offer.capacity.status !== "ready") return offer.capacity
  return {
    status: "planned",
    ...initialEnvironmentSpec(
      offer.capacity.capacity,
      needsOf(offer, (option) => choices[option]),
    ),
  }
}

export function optionFits(offer: BotCreationOffer, option: BotCreationOption): boolean {
  if (offer.capacity.status !== "ready") return false
  return initialEnvironmentSpec(
    offer.capacity.capacity,
    needsOf(offer, (offered) => offered === option),
  ).ok
}

export function noChoices(): BotCreationChoices {
  return choicesOf(() => false)
}

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
