import { followStream } from "../approvals/follow"
import { createStore, type Observable } from "../observable"
import { messageOf } from "../remote-feed"
import type { MainInputClient } from "./client"
import {
  EMPTY_DRAFT,
  sendableOf,
  uploadFailed,
  uploadProgressed,
  uploadStaged,
  withAttachments,
  withoutAttachment,
  withText,
} from "./draft"
import {
  availabilityOf,
  type ComposerState,
  connectionLost,
  INITIAL_COMPOSER,
  noticed,
  stateReceived,
  withoutNotice,
} from "./state"
import { type UploadSource, uploadAttachment } from "./uploads"

export interface MainComposerModel extends Observable<ComposerState> {
  readonly botId: string
  setText(text: string): void
  addFiles(files: readonly UploadSource[]): void
  removeAttachment(key: string): void
  send(): Promise<boolean>
  stop(): void
  dismissNotice(): void
}

export interface MainComposerTexts {
  notReady(): string
  uploading(): string
  failedAttachment(): string
}

export interface AttachmentPreviews {
  create(file: UploadSource): string | undefined
  revoke(url: string): void
}

export interface MainComposerDeps {
  readonly newDraftId: () => string
  readonly client: MainInputClient
  readonly texts: MainComposerTexts
  readonly previews: AttachmentPreviews
}

export function createMainComposerModel(deps: MainComposerDeps, botId: string): MainComposerModel {
  const { client, texts, previews } = deps
  const store = createStore<ComposerState>(INITIAL_COMPOSER)
  const update = (change: (state: ComposerState) => ComposerState) =>
    store.set(change(store.getSnapshot()))
  const uploads = new Map<string, AbortController>()
  let draftId = deps.newDraftId()
  let keys = 0
  let followers = 0
  let stopFollowing: (() => void) | undefined
  let opening = 0

  const follow = () => {
    const attempt = ++opening
    void client.watch(botId).then(
      (open) => {
        if (attempt !== opening) return
        stopFollowing = followStream({
          generation: client.generation,
          open,
          item: (state) => update((composer) => stateReceived(composer, state)),
          lost: (message) => update((composer) => connectionLost(composer, message)),
        })
      },
      (error: unknown) => {
        if (attempt === opening) update((composer) => connectionLost(composer, messageOf(error)))
      },
    )
  }
  const unfollow = () => {
    opening += 1
    stopFollowing?.()
    stopFollowing = undefined
  }

  const upload = (key: string, file: UploadSource, chunkBytes: number) => {
    const controller = new AbortController()
    uploads.set(key, controller)
    uploadAttachment(client, {
      botId,
      draft: draftId,
      file,
      chunkBytes,
      signal: controller.signal,
      progress: (sent) =>
        update((composer) => ({
          ...composer,
          draft: uploadProgressed(composer.draft, key, sent),
        })),
    }).then(
      (outcome) => {
        uploads.delete(key)
        if (controller.signal.aborted) {
          if (outcome.ok) void client.discard(botId, outcome.attachmentId)
          return
        }
        update((composer) => ({
          ...composer,
          draft: outcome.ok
            ? uploadStaged(composer.draft, key, outcome.attachmentId)
            : uploadFailed(composer.draft, key, outcome.failure.message),
        }))
      },
      (error: unknown) => {
        uploads.delete(key)
        if (controller.signal.aborted) return
        update((composer) => ({
          ...composer,
          draft: uploadFailed(composer.draft, key, messageOf(error)),
        }))
      },
    )
  }

  return {
    botId,
    getSnapshot: store.getSnapshot,
    subscribe(listener) {
      const off = store.subscribe(listener)
      followers += 1
      if (followers === 1) follow()
      return () => {
        off()
        followers -= 1
        if (followers === 0) unfollow()
      }
    },
    setText(text) {
      update((composer) => withoutNotice({ ...composer, draft: withText(composer.draft, text) }))
    },
    addFiles(files) {
      const availability = availabilityOf(store.getSnapshot())
      if (availability.kind !== "ready") {
        update((composer) => noticed(composer, texts.notReady()))
        return
      }
      const { chunkBytes } = availability.state.limits
      const added = files.map((file) => {
        const preview = previews.create(file)
        return {
          file,
          attachment: {
            key: `a${++keys}`,
            name: file.name,
            mediaType: file.type,
            bytes: file.size,
            ...(preview === undefined ? {} : { preview }),
            status: { kind: "uploading", sent: 0 } as const,
          },
        }
      })
      update((composer) =>
        withoutNotice({
          ...composer,
          draft: withAttachments(
            composer.draft,
            added.map((entry) => entry.attachment),
          ),
        }),
      )
      for (const { file, attachment } of added) upload(attachment.key, file, chunkBytes)
    },
    removeAttachment(key) {
      const attachment = store.getSnapshot().draft.attachments.find((entry) => entry.key === key)
      if (attachment === undefined) return
      uploads.get(key)?.abort()
      uploads.delete(key)
      if (attachment.status.kind === "ready")
        void client.discard(botId, attachment.status.attachmentId)
      if (attachment.preview !== undefined) previews.revoke(attachment.preview)
      update((composer) => ({ ...composer, draft: withoutAttachment(composer.draft, key) }))
    },
    async send() {
      const composer = store.getSnapshot()
      if (composer.sending || availabilityOf(composer).kind !== "ready") return false
      const sendable = sendableOf(composer.draft)
      if (!sendable.ok) {
        if (sendable.reason === "uploading") update((state) => noticed(state, texts.uploading()))
        if (sendable.reason === "failed") {
          update((state) => noticed(state, texts.failedAttachment()))
        }
        return false
      }
      update((state) => withoutNotice({ ...state, sending: true }))
      try {
        const result = await client.send(botId, sendable.submission)
        if (result.sent) {
          for (const attachment of composer.draft.attachments) {
            if (attachment.preview !== undefined) previews.revoke(attachment.preview)
          }
          draftId = deps.newDraftId()
          update((state) => ({ ...state, sending: false, draft: EMPTY_DRAFT }))
          return true
        }
        update((state) => noticed({ ...state, sending: false }, result.failure.message))
      } catch (error) {
        update((state) => noticed({ ...state, sending: false }, messageOf(error)))
      }
      return false
    },
    stop() {
      if (store.getSnapshot().stopping) return
      update((state) => ({ ...state, stopping: true }))
      client.stop(botId).then(
        (result) =>
          update((state) => {
            const stopped = { ...state, stopping: false }
            return result.ok ? stopped : noticed(stopped, result.message)
          }),
        (error: unknown) =>
          update((state) => noticed({ ...state, stopping: false }, messageOf(error))),
      )
    },
    dismissNotice() {
      update(withoutNotice)
    },
  }
}

export interface MainComposers {
  of(botId: string): MainComposerModel
}

export function createMainComposers(deps: MainComposerDeps): MainComposers {
  const models = new Map<string, MainComposerModel>()
  return {
    of(botId) {
      const existing = models.get(botId)
      if (existing !== undefined) return existing
      const model = createMainComposerModel(deps, botId)
      models.set(botId, model)
      return model
    },
  }
}
