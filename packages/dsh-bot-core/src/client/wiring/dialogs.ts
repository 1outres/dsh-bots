import type { BotCreationOffer } from "../../shared/bots"
import type { BotModelCatalog } from "../../shared/models"
import { CreateBotDialog, type CreateBotFace } from "../CreateBotDialog"
import { SLOT } from "../dsh/slots"
import type { GlobalSettingsTarget } from "../global-settings/flow"
import { createStore, type Store } from "../observable"
import type { RemoteMount } from "../remote"
import type { SettingsTarget } from "../settings/flow"
import type { ClientContext } from "../types"
import type { BotActions } from "./bots-face"
import { NAMESPACE } from "./plugin"

/** What of bot-core's frame-wide overlay is open; the sidebar and the shell open it, the overlay draws it. */
export interface DialogStores {
  readonly createDialog: Store<boolean>
  /** The bot whose settings screen is open, at which section. */
  readonly settings: Store<SettingsTarget | null>
  /** The dsh-bots settings screen, at which section. */
  readonly globalSettings: Store<GlobalSettingsTarget | null>
}

export function createDialogStores(): DialogStores {
  return {
    createDialog: createStore(false),
    settings: createStore<SettingsTarget | null>(null),
    globalSettings: createStore<GlobalSettingsTarget | null>(null),
  }
}

/** Register a component of bot-core's in the frame-wide `shell.overlay` layer. */
export function overlay(
  ctx: ClientContext,
  id: string,
  inject: () => object,
  component: Parameters<ClientContext["slots"]["register"]>[1],
): void {
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT.shellOverlay, () =>
        ctx.slots.register({ name: SLOT.shellOverlay, id, locale: NAMESPACE, inject }, component),
      ),
    `bot-core: ${id} overlay`,
  )
}

/** The creation options offered, through the `bots` Remote. */
async function creationOptions(mount: Promise<RemoteMount>): Promise<BotCreationOffer> {
  const mounted = await mount
  if (mounted.status === "failed") throw new Error(mounted.error)
  const result = await mounted.remote.bots.creationOptions()
  if (!result.ok) throw new Error(result.error.message ?? "request refused")
  return result.value
}

/** The New bot dialog. */
export function wireDialogs(
  ctx: ClientContext,
  sources: {
    readonly dialogs: DialogStores
    readonly actions: Pick<BotActions, "createBot">
    readonly remote: Promise<RemoteMount>
    readModelCatalog(): Promise<BotModelCatalog>
  },
): void {
  const { dialogs, actions, remote, readModelCatalog } = sources
  overlay(
    ctx,
    "bot-core.create",
    () =>
      ({
        createBot: actions.createBot,
        createDialog: dialogs.createDialog,
        creationOptions: () => creationOptions(remote),
        modelCatalog: readModelCatalog,
      }) satisfies CreateBotFace,
    CreateBotDialog,
  )
}
