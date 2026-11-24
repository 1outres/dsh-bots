import type { BotWorkspaceGrant } from "../../shared/workspaces"
import type { BotTable } from "../registry"
import { grantKey, type WorkspaceGrantRecord } from "./domain"

export interface GrantStoreDeps {
  /** The workspaces table of MANAGED_SESSIONS_DOMAIN; only this store writes it (design rule 56). */
  readonly workspaceGrants: BotTable<WorkspaceGrantRecord>
}

/** The Workspaces owners granted bots. Writes are serialized. */
export interface GrantStore {
  /** Every grant, oldest first; only `botId`'s when given. */
  list(botId?: string): BotWorkspaceGrant[]
  get(botId: string, workspaceId: string): BotWorkspaceGrant | undefined
  put(grant: BotWorkspaceGrant): Promise<BotWorkspaceGrant>
  /** Resolves to whether it was granted. */
  delete(botId: string, workspaceId: string): Promise<boolean>
  /** Drop the grants `keep` refuses; resolves to the dropped ones. */
  purge(keep: (grant: BotWorkspaceGrant) => boolean): Promise<readonly BotWorkspaceGrant[]>
  subscribe(listener: () => void): () => void
}

export function createGrantStore(deps: GrantStoreDeps): GrantStore {
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const all = () =>
    [...deps.workspaceGrants.entries()]
      .map(([, record]) => record)
      .sort(
        (a, b) =>
          a.since - b.since ||
          grantKey(a.botId, a.workspaceId).localeCompare(grantKey(b.botId, b.workspaceId)),
      )

  return {
    list: (botId) => all().filter((grant) => botId === undefined || grant.botId === botId),
    get: (botId, workspaceId) => deps.workspaceGrants.get(grantKey(botId, workspaceId)),
    put: (grant) =>
      serial(async () => {
        await deps.workspaceGrants.put(grantKey(grant.botId, grant.workspaceId), grant)
        publish()
        return grant
      }),
    delete: (botId, workspaceId) =>
      serial(async () => {
        const key = grantKey(botId, workspaceId)
        if (deps.workspaceGrants.get(key) === undefined) return false
        await deps.workspaceGrants.delete(key)
        publish()
        return true
      }),
    purge: (keep) =>
      serial(async () => {
        const dropped = all().filter((grant) => !keep(grant))
        for (const grant of dropped)
          await deps.workspaceGrants.delete(grantKey(grant.botId, grant.workspaceId))
        if (dropped.length > 0) publish()
        return dropped
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
