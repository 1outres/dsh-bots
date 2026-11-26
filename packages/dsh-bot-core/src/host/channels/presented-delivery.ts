import type { EnvironmentFileSystem } from "../files"
import { readWorkspaceFile } from "../workspace-file"
import type { ChannelOutlets, FileDelivery } from "./outlets"
import type { PresentedFile } from "./presented"
import { type PresentedNotice, presentedNoticeOf } from "./presented-notice"

export type PresentedFileResult =
  | { readonly kind: "unreadable"; readonly file: PresentedFile; readonly reason: string }
  | {
      readonly kind: "queued"
      readonly file: PresentedFile
      readonly deliveries: readonly FileDelivery[]
    }

export type PresentedReport =
  | { readonly kind: "environment-unavailable"; readonly files: readonly PresentedFile[] }
  | { readonly kind: "read"; readonly results: readonly PresentedFileResult[] }

export interface PresentedDeliveryDeps {
  environmentOf(
    botId: string,
  ): { readonly fs: EnvironmentFileSystem; readonly workspace: string } | undefined
  outlets: Pick<ChannelOutlets, "fileTargets" | "sendFile">
  readonly maxBytes: number
  signal(): AbortSignal
  notify(botId: string, notice: PresentedNotice): Promise<void>
  warn(message: string): void
}

export interface PresentedDelivery {
  deliver(botId: string, files: readonly PresentedFile[]): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createPresentedDelivery(deps: PresentedDeliveryDeps): PresentedDelivery {
  const report = (botId: string, outcome: Promise<PresentedReport>) => {
    void outcome
      .then((settled) => {
        const notice = presentedNoticeOf(settled)
        return notice === undefined ? undefined : deps.notify(botId, notice)
      })
      .catch((error: unknown) => {
        deps.warn(
          `bot-core: could not tell bot "${botId}" which presented files were not sent: ${messageOf(error)}`,
        )
      })
  }

  return {
    async deliver(botId, files) {
      const targets = deps.outlets.fileTargets(botId)
      if (files.length === 0 || targets.length === 0) return
      const environment = deps.environmentOf(botId)
      if (environment === undefined) {
        report(botId, Promise.resolve({ kind: "environment-unavailable", files }))
        return
      }
      const limit = Math.min(deps.maxBytes, Math.max(...targets.map((target) => target.maxBytes)))
      const signal = deps.signal()
      const results: Promise<PresentedFileResult>[] = []
      for (const file of files) {
        try {
          const read = await readWorkspaceFile(
            environment.fs,
            environment.workspace,
            file.path,
            limit,
            signal,
          )
          const deliveries = deps.outlets.sendFile(botId, {
            name: read.name,
            data: read.data,
            ...(file.description === undefined ? {} : { caption: file.description }),
          })
          results.push(
            deliveries.then((settled) => ({ kind: "queued", file, deliveries: settled })),
          )
        } catch (error) {
          results.push(Promise.resolve({ kind: "unreadable", file, reason: messageOf(error) }))
        }
      }
      report(
        botId,
        Promise.all(results).then((settled) => ({ kind: "read", results: settled })),
      )
    },
  }
}
