import type { MatrixTables } from "./domain"

export async function adoptHomeRecords(
  tables: Pick<MatrixTables, "cards" | "digests" | "incidents">,
  botId: string,
  roomId: string,
): Promise<void> {
  for (const records of [tables.cards, tables.digests, tables.incidents] as const) {
    for (const [key, value] of [...records.entries()]) {
      if (value.botId === botId && value.roomId !== roomId) await records.delete(key)
    }
  }
}

export async function forgetBotRecords(
  tables: Pick<MatrixTables, "homes" | "cursors" | "cards" | "digests" | "incidents">,
  botId: string,
): Promise<void> {
  await tables.homes.delete(botId)
  await tables.cursors.delete(botId)
  for (const records of [tables.cards, tables.digests, tables.incidents] as const) {
    for (const [key, value] of [...records.entries()]) {
      if (value.botId === botId) await records.delete(key)
    }
  }
}
