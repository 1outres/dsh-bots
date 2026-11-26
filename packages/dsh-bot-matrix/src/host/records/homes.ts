import type { HomeRecord, MatrixTables } from "./domain"

export interface HomeRecords {
  get(botId: string): HomeRecord | undefined
  save(botId: string, owner: string, roomId: string): Promise<void>
}

export function openHomeRecords(
  tables: Pick<MatrixTables, "homes">,
  now: () => number,
): HomeRecords {
  return {
    get: (botId) => tables.homes.get(botId),
    save: (botId, owner, roomId) =>
      tables.homes.put(botId, { botId, owner, roomId, updatedAt: now() }),
  }
}
