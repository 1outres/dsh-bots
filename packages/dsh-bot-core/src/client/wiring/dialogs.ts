import type { BotCreationOffer } from "../../shared/bots"
import { CreateBotDialog, type CreateBotFace } from "../CreateBotDialog"
import type { CreationSources } from "../creation/use-creation-form"
import { SLOT } from "../dsh/slots"
import type { GlobalSettingsTarget } from "../global-settings/flow"
import { createStore, type Store } from "../observable"
import type { RemoteMount } from "../remote"
import type { SettingsTarget } from "../settings/flow"
import type { ClientContext } from "../types"
import type { BotActions } from "./bots-face"
import { NAMESPACE } from "./plugin"

export interface DialogStores {
  readonly createDialog: Store<boolean>
  readonly settings: Store<SettingsTarget | null>
  readonly globalSettings: Store<GlobalSettingsTarget | null>
}

export function createDialogStores(): DialogStores {
  return {
    createDialog: createStore(false),
    settings: createStore<SettingsTarget | null>(null),
    globalSettings: createStore<GlobalSettingsTarget | null>(null),
  }
}

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

export async function creationOptions(mount: Promise<RemoteMount>): Promise<BotCreationOffer> {
  const mounted = await mount
  if (mounted.status === "failed") throw new Error(mounted.error)
  const result = await mounted.remote.bots.creationOptions()
  if (!result.ok) throw new Error(result.error.message ?? "request refused")
  return result.value
}

export function wireDialogs(
  ctx: ClientContext,
  sources: {
    readonly dialogs: DialogStores
    readonly actions: Pick<BotActions, "createBot">
    readonly creation: CreationSources
  },
): void {
  const { dialogs, actions, creation } = sources
  overlay(
    ctx,
    "bot-core.create",
    () =>
      ({
        createBot: actions.createBot,
        createDialog: dialogs.createDialog,
        ...creation,
      }) satisfies CreateBotFace,
    CreateBotDialog,
  )
}
