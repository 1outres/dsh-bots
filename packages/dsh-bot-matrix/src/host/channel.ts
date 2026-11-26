import type { BotChannel, BotChannelCapabilities } from "@1outres/dsh-bot-core"
import { createAccountCleaner } from "./accounts"
import { createMatrixBridge } from "./bridge"
import { MATRIX_FIELDS } from "./fields"
import type { OpenMatrixApi } from "./matrix"
import type { Scheduler } from "./ports"
import { openAccountRecords } from "./records/accounts"
import { openCursorRecords } from "./records/cursors"
import type { MatrixTables } from "./records/domain"
import { openHomeRecords } from "./records/homes"
import { createMatrixSettingsQueries } from "./settings/queries"
import { MATRIX_SHARED_FIELDS } from "./shared-fields"

export interface MatrixChannelDeps {
  readonly open: OpenMatrixApi
  readonly tables: MatrixTables
  readonly scheduler: Scheduler
  now(): number
  warn(message: string): void
}

const MIB = 1024 * 1024

export const MATRIX_CAPABILITIES = {
  attachments: { maxCount: 1, maxBytes: 100 * MIB },
  files: { maxBytes: 100 * MIB },
  turns: true,
  interactions: ["question", "approval", "plan-review"],
  commands: ["stop", "status", "new"],
  connectorActions: true,
  credentialIncidents: true,
  profile: { name: true, avatar: true },
} as const satisfies BotChannelCapabilities

export function createMatrixChannel(
  deps: MatrixChannelDeps,
): BotChannel<typeof MATRIX_FIELDS, typeof MATRIX_SHARED_FIELDS> {
  const accounts = openAccountRecords(deps.tables, deps.now)
  const homes = openHomeRecords(deps.tables, deps.now)
  const cursors = openCursorRecords(deps.tables, deps.now)
  const queries = createMatrixSettingsQueries({ open: deps.open, accounts, homes })
  const cleaner = createAccountCleaner({
    open: deps.open,
    records: accounts,
    tables: deps.tables,
    warn: deps.warn,
  })
  return {
    id: "matrix",
    name: "Matrix",
    description: {
      en: "A Matrix account of this bot's own on your homeserver, at one home: a direct chat with you, or a room everyone in it can talk in. The homeserver is connected once in dsh-bots settings.",
      ja: "あなたの homeserver にあるこのボット専用の Matrix アカウント。ホームは 1 つ: あなたとのダイレクトチャットか、部屋の全員が話せる部屋。homeserver は dsh-bots の設定で一度だけつなぎます。",
    },
    guide: "https://github.com/1outres/dsh-bots/tree/main/packages/dsh-bot-matrix#matrix-setup",
    fields: MATRIX_FIELDS,
    owners: "approvers",
    capabilities: MATRIX_CAPABILITIES,
    shared: {
      fields: MATRIX_SHARED_FIELDS,
      description: {
        en: "Your homeserver, reached as an application service: dsh-bots makes each bot's Matrix account itself. Register the file below with the homeserver first.",
        ja: "Application Service としてつなぐあなたの homeserver。ボットごとの Matrix アカウントは dsh-bots が作ります。先に下の登録ファイルを homeserver に登録してください。",
      },
      check: (request) => queries.checkShared(request),
      inspect: (request) => queries.inspectShared(request),
      describeInitial: (shared) => queries.describeInitial(shared),
    },
    options: (request) => queries.options(request),
    check: (request) => queries.check(request),
    inspect: (request) => queries.inspect(request),
    initialSettings: (request) => queries.initialSettings(request),
    accounts: { reconcile: (request) => cleaner.reconcile(request) },
    formatHint: "Markdown renders, tables included; no raw HTML.",
    connect: (link) =>
      createMatrixBridge({
        link,
        open: deps.open,
        tables: deps.tables,
        accounts,
        homes,
        cursors,
        scheduler: deps.scheduler,
        warn: deps.warn,
      }),
  }
}
