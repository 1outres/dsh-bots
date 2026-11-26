import type { AccountRecord, MatrixTables } from "./domain"

export interface AccountRecords {
  get(botId: string): AccountRecord | undefined
  list(): readonly AccountRecord[]
  activate(botId: string, userId: string, serverName: string): Promise<AccountRecord>
  retiring(botId: string): Promise<void>
  retired(botId: string, retirement: "deactivated" | "vacated"): Promise<void>
  profileApplied(
    botId: string,
    profile: { readonly name?: string; readonly avatar?: string },
  ): Promise<void>
}

export function openAccountRecords(
  tables: Pick<MatrixTables, "accounts">,
  now: () => number,
): AccountRecords {
  const { accounts } = tables
  const update = async (botId: string, change: Partial<AccountRecord>) => {
    const current = accounts.get(botId)
    if (current === undefined) return
    await accounts.put(botId, { ...current, ...change, updatedAt: now() })
  }
  return {
    get: (botId) => accounts.get(botId),
    list: () => [...accounts.entries()].map(([, record]) => record),
    async activate(botId, userId, serverName) {
      const current = accounts.get(botId)
      if (current !== undefined && current.userId === userId && current.state === "active")
        return current
      const at = now()
      const record: AccountRecord = {
        botId,
        userId,
        serverName,
        state: "active",
        createdAt: current?.createdAt ?? at,
        updatedAt: at,
      }
      await accounts.put(botId, record)
      return record
    },
    retiring: (botId) => update(botId, { state: "retiring" }),
    retired: (botId, retirement) => update(botId, { state: "retired", retirement }),
    profileApplied: (botId, profile) => update(botId, { profile }),
  }
}
