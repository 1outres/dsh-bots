import { SLOT } from "../dsh/slots"
import { createMainInputClient } from "../main-input/client"
import { MainComposer, type MainComposerFace } from "../main-input/MainComposer"
import { createMainComposers, type MainComposerDeps } from "../main-input/model"
import type { MainBinding } from "../main-session"
import { createStore, derive, type Observable } from "../observable"
import type { RemoteMount } from "../remote"
import { type BotsState, type RegistrationStatus, snapshotOf } from "../session-classification"
import { createSlotRegistration } from "../slot-registration"
import type { ClientContext } from "../types"
import { NAMESPACE } from "./plugin"

export interface MainComposerSources {
  readonly remote: Promise<RemoteMount>
  readonly bots: Observable<BotsState>
  readonly binding: Observable<MainBinding>
}

function draftId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function showsCurrentMain(binding: MainBinding, bots: BotsState): boolean {
  if (binding.kind !== "session") return false
  return snapshotOf(bots)?.bots.some((bot) => bot.mainSessionId === binding.sessionId) === true
}

export function wireMainComposer(
  ctx: ClientContext,
  sources: MainComposerSources,
): Observable<RegistrationStatus> {
  const t = ctx.locale.bind(NAMESPACE)
  const deps: MainComposerDeps = {
    newDraftId: draftId,
    client: createMainInputClient(sources.remote, ctx.connection.generation),
    texts: {
      notReady: () => t("mainComposer.notReady"),
      uploading: () => t("mainComposer.stillUploading"),
      failedAttachment: () => t("mainComposer.failedAttachment"),
    },
    previews: {
      create: (file) =>
        file instanceof Blob && file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      revoke: (url) => URL.revokeObjectURL(url),
    },
  }
  const composers = createMainComposers(deps)
  const face: MainComposerFace = {
    composerOf(sessionId) {
      if (sessionId === undefined) return undefined
      const bot = snapshotOf(sources.bots.getSnapshot())?.bots.find(
        (candidate) => candidate.mainSessionId === sessionId,
      )
      return bot === undefined ? undefined : composers.of(bot.id)
    },
  }
  const wanted = derive([sources.binding, sources.bots], showsCurrentMain)
  const status = createStore<RegistrationStatus>({ state: "idle" })
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT.composerBar, () => {
        const registration = createSlotRegistration({
          wanted,
          label: `bot Main ${SLOT.composerBar}`,
          register: (priority) =>
            ctx.slots.register(
              { name: SLOT.composerBar, priority, locale: NAMESPACE, inject: () => face },
              MainComposer,
            ),
        })
        const report = () => status.set(registration.getSnapshot())
        report()
        const off = registration.subscribe(report)
        return () => {
          registration.dispose()
          report()
          off()
        }
      }),
    `bot-core: bot Main ${SLOT.composerBar}`,
  )
  return status
}
