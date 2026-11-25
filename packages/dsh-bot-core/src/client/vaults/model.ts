import type {
  BotVaultsSnapshot,
  BotVaultView,
  VaultAccountRequest,
  VaultAccountView,
  VaultGrantChange,
  VaultGrantRequest,
  VaultGrantView,
  VaultIncidentView,
  VaultItemView,
} from "../../shared/vaults"
import { followStream } from "../approvals/follow"
import { createFeedHub } from "../feed-hub"
import { createStore, type Observable } from "../observable"
import type { BotVaultsRemote, RemoteMount } from "../remote"
import type { RemoteResult } from "../types"

/** Why the password managers or a bot's logins cannot be read or changed. */
export type VaultsFailure =
  | { readonly kind: "mount"; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }

export class VaultsError extends Error {
  override readonly name = "VaultsError"
  constructor(readonly failure: VaultsFailure) {
    super(failure.message)
  }
}

export type VaultsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: BotVaultsSnapshot }
  | { readonly status: "failed"; readonly failure: VaultsFailure }

export type BotVaultState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: BotVaultView }
  | { readonly status: "failed"; readonly failure: VaultsFailure }

export interface VaultsOperations {
  addAccount(request: VaultAccountRequest): Promise<VaultAccountView>
  renameAccount(accountId: string, label: string): Promise<VaultAccountView>
  removeAccount(accountId: string): Promise<{ readonly removedGrants: number }>
  listItems(accountId: string, query: string): Promise<readonly VaultItemView[]>
}

export interface BotVaultOperations {
  grant(request: VaultGrantRequest): Promise<VaultGrantView>
  updateGrant(grantId: string, change: VaultGrantChange): Promise<VaultGrantView>
  revoke(grantId: string): Promise<{ readonly revoked: true }>
  acknowledge(incidentId: string): Promise<VaultIncidentView>
}

interface Followed<S> extends Observable<S> {
  dispose(): void
}

export interface VaultsDeps {
  readonly mount: Promise<RemoteMount>
  readonly generation: Observable<object | undefined>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function vaultsOf(mount: Promise<RemoteMount>): Promise<BotVaultsRemote> {
  const mounted = await mount
  if (mounted.status === "failed") throw new VaultsError({ kind: "mount", message: mounted.error })
  return mounted.remote.botVaults
}

async function call<T>(
  mount: Promise<RemoteMount>,
  run: (vaults: BotVaultsRemote) => Promise<RemoteResult<T>>,
): Promise<T> {
  const vaults = await vaultsOf(mount)
  let result: RemoteResult<T>
  try {
    result = await run(vaults)
  } catch (error) {
    throw new VaultsError({ kind: "connection", message: messageOf(error) })
  }
  if (result.ok) return result.value
  const { message } = result.error
  throw new VaultsError(
    message === undefined
      ? { kind: "protocol", message: "a refusal without a message" }
      : { kind: "refused", message },
  )
}

/** Follow a stream into a store of `ready` / `failed` states; the last ready one stays while it reconnects. */
function follow<T, S>(
  deps: VaultsDeps,
  open: (vaults: BotVaultsRemote) => AsyncIterable<T> & { dispose(): void },
  ready: (value: T) => S,
  failed: (failure: VaultsFailure) => S,
  loading: S,
  isReady: (state: S) => boolean,
): Followed<S> {
  const state = createStore<S>(loading)
  let disposed = false
  let stop: (() => void) | undefined
  void vaultsOf(deps.mount).then(
    (vaults) => {
      if (disposed) return
      stop = followStream<T>({
        generation: deps.generation,
        open: () => open(vaults),
        item: (value) => state.set(ready(value)),
        lost(message) {
          if (isReady(state.getSnapshot()) || message === undefined) return
          state.set(failed({ kind: "connection", message }))
        },
      })
    },
    (error: unknown) => {
      if (!disposed) {
        state.set(
          failed(
            error instanceof VaultsError
              ? error.failure
              : { kind: "connection", message: messageOf(error) },
          ),
        )
      }
    },
  )
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    dispose() {
      disposed = true
      stop?.()
    },
  }
}

/** The password managers, streamed while anything shows them; one stream for every screen. */
export type VaultsFeed = Observable<VaultsState> & VaultsOperations

export function createVaultsFeed(deps: VaultsDeps): VaultsFeed {
  const hub = createFeedHub<VaultsState, Followed<VaultsState>, VaultsOperations>({
    name: "password managers",
    idle: { status: "loading" },
    open: () =>
      follow<BotVaultsSnapshot, VaultsState>(
        deps,
        (vaults) => vaults.watch(),
        (snapshot) => ({ status: "ready", snapshot }),
        (failure) => ({ status: "failed", failure }),
        { status: "loading" },
        (state) => state.status === "ready",
      ),
    extend: () => ({
      addAccount: (request) => call(deps.mount, (vaults) => vaults.addAccount(request)),
      renameAccount: (accountId, label) =>
        call(deps.mount, (vaults) => vaults.renameAccount(accountId, label)),
      removeAccount: (accountId) => call(deps.mount, (vaults) => vaults.removeAccount(accountId)),
      listItems: (accountId, query) =>
        call(deps.mount, (vaults) => vaults.listItems(accountId, query)),
    }),
  })
  return hub.feed("all")
}

/** One bot's logins, uses and incidents, streamed while anything shows them. */
export type BotVaultFeed = Observable<BotVaultState> & BotVaultOperations

export interface BotVaultsHub {
  feed(botId: string): BotVaultFeed
}

export function createBotVaultsHub(deps: VaultsDeps): BotVaultsHub {
  const hubs = new Map<string, BotVaultFeed>()
  const hub = createFeedHub<BotVaultState, Followed<BotVaultState>, Record<never, never>>({
    name: "logins",
    idle: { status: "loading" },
    open: (botId) =>
      follow<BotVaultView, BotVaultState>(
        deps,
        (vaults) => vaults.watchBot(botId),
        (view) => ({ status: "ready", view }),
        (failure) => ({ status: "failed", failure }),
        { status: "loading" },
        (state) => state.status === "ready",
      ),
    extend: () => ({}),
  })
  return {
    feed(botId) {
      const existing = hubs.get(botId)
      if (existing !== undefined) return existing
      const observed = hub.feed(botId)
      const feed: BotVaultFeed = {
        getSnapshot: observed.getSnapshot,
        subscribe: observed.subscribe,
        grant: (request) => call(deps.mount, (vaults) => vaults.grant(botId, request)),
        updateGrant: (grantId, change) =>
          call(deps.mount, (vaults) => vaults.updateGrant(botId, grantId, change)),
        revoke: (grantId) => call(deps.mount, (vaults) => vaults.revoke(botId, grantId)),
        acknowledge: (incidentId) =>
          call(deps.mount, (vaults) => vaults.acknowledgeIncident(botId, incidentId)),
      }
      hubs.set(botId, feed)
      return feed
    },
  }
}

const NONE: Readonly<Record<string, number>> = {}

/** Unacknowledged credential incidents per bot, as the Bots list and the shell show them. */
export function openIncidentsOf(state: VaultsState): Readonly<Record<string, number>> {
  return state.status === "ready" ? state.snapshot.openIncidents : NONE
}
