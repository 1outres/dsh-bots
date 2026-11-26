import type { CursorRecord, MatrixTables } from "./domain"

export interface CursorRecords {
  get(botId: string): CursorRecord | undefined
  save(
    botId: string,
    cursor: { readonly since: string; readonly roomId: string; readonly lastEventId?: string },
  ): Promise<void>
  forget(botId: string): Promise<void>
}

export function openCursorRecords(
  tables: Pick<MatrixTables, "cursors">,
  now: () => number,
): CursorRecords {
  return {
    get: (botId) => tables.cursors.get(botId),
    save: (botId, cursor) => tables.cursors.put(botId, { botId, ...cursor, updatedAt: now() }),
    async forget(botId) {
      await tables.cursors.delete(botId)
    },
  }
}
