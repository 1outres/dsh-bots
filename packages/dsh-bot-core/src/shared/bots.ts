import { BOT_CREATION_OPTIONS, type BotCreationOption } from "./connectors"
import type { BotEnvironmentCapacityState, BotEnvironmentNeed } from "./environment"
import type { BotModelCatalog, BotModelsChange, BotModelsView } from "./models"

/**
 * A bot's picture: an emoji or the name's initial letter on a colored disc, or
 * a small uploaded image. Glyph and color are chosen independently.
 */
export type BotAvatar =
  | { readonly kind: "emoji"; readonly emoji: string; readonly color: string }
  | { readonly kind: "initial"; readonly text: string; readonly color: string }
  | { readonly kind: "image"; readonly dataUrl: string }

/** One bot as the browser sees it. */
export interface BotView {
  readonly id: string
  readonly name: string
  readonly avatar: BotAvatar
  /**
   * The bot's current Main session: its channels and notices reach it, and it
   * is never archived while it is the Main. A new Main takes its place
   * (docs/specs/bot-main-rotation.md); the former one is archived and joins
   * {@link sessionIds}.
   */
  readonly mainSessionId: string
  /** When the current Main became the Main. */
  readonly mainStartedAt: number
  /**
   * The bot's other sessions, in the order they joined them: by creation, a
   * former Main when it was replaced (archived ones included; subagent
   * sessions and the Main are not here). Bot sessions belong to no Workspace:
   * bot-core records them itself, and the browser builds the Bots tree from this.
   */
  readonly sessionIds: readonly string[]
  /** The former Mains among {@link sessionIds}: they are not managed sessions (docs/specs/bot-managed-sessions.md). */
  readonly formerMainIds: readonly string[]
  /** The bot's IANA time zone, which its schedule jobs default to. */
  readonly timezone: string
  /** The language the bot greets its owner in (a BCP 47 tag); absent until one is chosen. */
  readonly language?: string
  readonly createdAt: number
}

/** Every session of a listed bot: its Main and its other sessions. */
export function sessionsOfBot(bot: BotView): readonly string[] {
  return [bot.mainSessionId, ...bot.sessionIds]
}

/** What the bot's environment reports while it prepares one bot, in order. */
export const ENVIRONMENT_PHASES = ["queued", "creating", "booting", "connecting"] as const

export type EnvironmentPhase = (typeof ENVIRONMENT_PHASES)[number]

/** The steps of creating a bot: its environment's, then bot-core's own. */
export const CREATION_PHASES = [...ENVIRONMENT_PHASES, "preset", "starting-main"] as const

export type CreationPhase = (typeof CREATION_PHASES)[number]

export interface BotFailure {
  readonly message: string
  readonly at: number
}

/** What is happening to a bot that is not listed. */
export type BotOperation =
  | { readonly kind: "create"; readonly phase: CreationPhase }
  | { readonly kind: "remove" }

/**
 * A bot being created (stored, no Main session yet) or removed (its record
 * gone, its sessions or environment not cleaned up yet), or whose creation or
 * removal failed and waits for a retry, a discard or a dismissal.
 */
export interface PendingBotView {
  readonly id: string
  readonly name: string
  readonly avatar: BotAvatar
  readonly operation: BotOperation
  /** When the current attempt of the operation started. */
  readonly startedAt: number
  /** Set once the attempt failed; it stays until retried, discarded or dismissed. */
  readonly failure?: BotFailure
  /** Its recorded sessions, hidden from the browser's own lists like a listed bot's. */
  readonly sessionIds: readonly string[]
  readonly createdAt: number
}

/** What the `bots` Remote's `watch` streams. */
export interface BotsSnapshot {
  /** Listed bots: those with a Main session. */
  readonly bots: readonly BotView[]
  /** Bots being created or removed, oldest first. */
  readonly pending: readonly PendingBotView[]
  /**
   * Sessions still being prepared (a new session until its environment
   * answers, a new bot's Main until its greeting is sent): the browser shows
   * them as getting ready. Any other blank bot session takes input at once.
   */
  readonly preparingSessionIds: readonly string[]
}

/** A request the Host accepted; its progress and outcome come through `watch`. */
export interface BotAccepted {
  readonly accepted: true
}

/**
 * Which creation options a new bot starts with: the registered connectors of
 * each one on are enabled with their default settings before its environment
 * is first ensured; every other connector starts off. A new bot's spec
 * (`initialEnvironmentSpec`, from the environment's capacity when it is
 * created) gives every option on what it needs, or the creation is refused.
 */
export type BotCreationChoices = { readonly [Option in BotCreationOption]: boolean }

export interface BotCreateInput extends BotCreationChoices {
  readonly name: string
  readonly avatar: BotAvatar
  /** The language the browser shows bot-core in (its `format.locale`), a BCP 47 tag. */
  readonly language: string
  /** The bot's IANA time zone (the creator's browser's unless changed); the Host canonicalizes it and refuses an unknown one. */
  readonly timezone: string
  /** Its models; roles not given start at {@link DEFAULT_BOT_MODELS}' choice. */
  readonly models?: BotModelsChange
}

/** One creation option offered, with what its connectors need of the bot's environment. */
export interface BotCreationOptionOffer {
  readonly option: BotCreationOption
  readonly needs: readonly BotEnvironmentNeed[]
}

/** What the New bot dialog offers besides the name and avatar. */
export interface BotCreationOffer {
  /** The options some registered connector belongs to, in their order. */
  readonly options: readonly BotCreationOptionOffer[]
  /** What the environment accepts for a new bot now; its spec is `initialEnvironmentSpec` of it. */
  readonly capacity: BotEnvironmentCapacityState
}

export interface BotUpdateInput {
  readonly name?: string
  readonly avatar?: BotAvatar
  /** An IANA time zone; the Host canonicalizes it and refuses an unknown one. */
  readonly timezone?: string
  /** A BCP 47 language tag. */
  readonly language?: string
}

/** The `bots` Remote. */
export interface BotsApi {
  /** The current snapshot, then one after every change. */
  watch(signal?: AbortSignal): AsyncIterable<BotsSnapshot>
  /**
   * Store a new bot and start preparing it: its environment, its preset, then
   * its Main session. Resolves once stored; `watch` lists it as pending
   * meanwhile and as a bot once its Main session started.
   * @throws when the input is invalid or no bot can be created now.
   */
  create(input: BotCreateInput): Promise<{ readonly id: string }>
  /** What the New bot dialog offers besides the name and avatar. */
  creationOptions(): Promise<BotCreationOffer>
  /** Start a failed creation again from where it failed. */
  retryCreate(id: string): Promise<BotAccepted>
  /** Give up a creation (failed or not): the bot is removed like a deleted one. */
  discardCreate(id: string): Promise<BotAccepted>
  update(id: string, input: BotUpdateInput): Promise<BotView>
  /**
   * Delete a listed bot: resolves once its record is gone; `watch` lists it as
   * pending until its sessions are archived and its environment is removed.
   * Not named `remove`: the browser namespace service owns that name.
   */
  removeBot(id: string): Promise<BotAccepted>
  /** Run the failed steps of a removal again. */
  retryRemove(id: string): Promise<BotAccepted>
  /** Stop listing a failed removal; its environment keeps being retried in the background. */
  dismissRemove(id: string): Promise<BotAccepted>
  /** `Bot.createSession`: a new session of the bot, under its preset in its environment's workspace. */
  createSession(botId: string): Promise<{ readonly sessionId: string }>
  /** The bot's model of every role. */
  models(id: string): Promise<BotModelsView>
  /** The bot's models now, then again after every change. */
  watchModels(id: string, signal?: AbortSignal): AsyncIterable<BotModelsView>
  /**
   * Replace the choice of the roles the change names, each fixed one checked
   * against DSH's LLM registry first (nothing is stored when one is refused).
   * Naming `main` also applies it to the Main session (`mainPending` until it took it).
   */
  configureModels(id: string, change: BotModelsChange): Promise<BotModelsView>
  /** DSH's registered providers, their advertised models and efforts, and its default model. */
  modelCatalog(): Promise<BotModelCatalog>
}

export const MAX_NAME_LENGTH = 64
/** Upper bound of an image avatar's data URL, about 150 KiB of image bytes. */
export const MAX_AVATAR_DATA_URL = 200_000
/** Upper bound, in UTF-16 units, of an emoji or initial glyph (one grapheme can span several). */
export const MAX_AVATAR_GLYPH = 16

const COLOR = /^#[0-9a-fA-F]{6}$/

function glyph(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_AVATAR_GLYPH) {
    throw new Error(`avatar ${what} is invalid`)
  }
  return value
}

function color(value: unknown): string {
  if (typeof value !== "string" || !COLOR.test(value)) throw new Error("avatar color is invalid")
  return value
}

/** Trimmed name, or an error message when it cannot be used. */
export function validateName(name: unknown): string {
  if (typeof name !== "string") throw new Error("name must be a string")
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error("name is empty")
  if (trimmed.length > MAX_NAME_LENGTH) throw new Error(`name is longer than ${MAX_NAME_LENGTH}`)
  return trimmed
}

/** A creation's choices (untrusted input): every option given as true or false. */
export function validateCreationChoices(input: unknown): BotCreationChoices {
  if (typeof input !== "object" || input === null) throw new Error("the creation is missing")
  const value = input as Record<string, unknown>
  return Object.fromEntries(
    BOT_CREATION_OPTIONS.map((option) => {
      const chosen = value[option]
      if (typeof chosen !== "boolean") throw new Error(`${option} must be true or false`)
      return [option, chosen]
    }),
  ) as BotCreationChoices
}

const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

/** A BCP 47-style language tag (as DSH's locale preference accepts), or an error. */
export function validateLanguage(language: unknown): string {
  if (typeof language !== "string" || !LANGUAGE_TAG.test(language)) {
    throw new Error("language must be a BCP 47 language tag such as en or ja")
  }
  return language
}

export function validateAvatar(avatar: unknown): BotAvatar {
  if (typeof avatar !== "object" || avatar === null) throw new Error("avatar is missing")
  const value = avatar as Record<string, unknown>
  if (value.kind === "emoji") {
    return { kind: "emoji", emoji: glyph(value.emoji, "emoji"), color: color(value.color) }
  }
  if (value.kind === "initial") {
    return { kind: "initial", text: glyph(value.text, "initial"), color: color(value.color) }
  }
  if (value.kind === "image") {
    if (
      typeof value.dataUrl !== "string" ||
      !/^data:image\/(png|jpeg|webp|gif);base64,/.test(value.dataUrl) ||
      value.dataUrl.length > MAX_AVATAR_DATA_URL
    ) {
      throw new Error("avatar image is invalid or too large")
    }
    return { kind: "image", dataUrl: value.dataUrl }
  }
  throw new Error("avatar kind is unknown")
}
