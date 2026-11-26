import { ArchiveConfirmDialog, type ArchiveConfirmProps } from "../ArchiveConfirmDialog"
import { BotNoticeToast, type NoticeToastProps } from "../BotNoticeToast"
import type { BotsFace } from "../face"
import type { NoticeStore } from "../notices"
import type { SessionArchive } from "../session-archive"
import { registerBotSessionMenu } from "../session-menu"
import type { ClientContext } from "../types"
import { overlay } from "./dialogs"
import { NAMESPACE } from "./plugin"

export interface ArchiveWiringSources {
  readonly archive: SessionArchive
  readonly notices: NoticeStore
  readonly face: Pick<BotsFace, "bots" | "workspaces" | "setArchivedShown" | "managed">
}

export function wireArchive(ctx: ClientContext, sources: ArchiveWiringSources): void {
  const { archive, notices, face } = sources
  registerBotSessionMenu(ctx, face, archive, ctx.locale.bind(NAMESPACE))
  overlay(
    ctx,
    "bot-core.archive-confirm",
    () => ({ archive }) satisfies Omit<ArchiveConfirmProps, "t">,
    ArchiveConfirmDialog,
  )
  overlay(
    ctx,
    "bot-core.notices",
    () =>
      ({
        notices,
        actions: {
          undoArchive: (botId, sessionId) => archive.unarchive(botId, sessionId),
          showArchived: (botId) => face.setArchivedShown(botId, true),
        },
      }) satisfies Omit<NoticeToastProps, "t">,
    BotNoticeToast,
  )
}
