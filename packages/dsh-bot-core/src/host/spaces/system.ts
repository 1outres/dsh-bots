import type {
  SpaceAccessRecord,
  SpaceKvRecord,
  SpaceRecord,
  SpaceRevision,
  SpaceSettingsRecord,
} from "../../shared/spaces"
import { SPACE_LIMITS, spaceIdOf } from "../../shared/spaces"
import type { OwnerApprovals } from "../interactions/owner-approval"
import type { NoticeSpace } from "../notices/domain"
import type { BotTable } from "../registry"
import { createSpaceAccess, type SpaceAccess } from "./access"
import { openSpaceBlobs, type SpaceBlobIo } from "./blobs"
import { createSpaceEvents } from "./events"
import { createSpaceHttp, type SpaceHttpRequest, type SpaceHttpResponse } from "./http"
import { createSpaceKv } from "./kv"
import { createSpaceLive } from "./live"
import { createSpaceManager, type SpaceManager, type SpacePlace } from "./manage"
import { createSpacesPanel, type SpacesPanel } from "./panel"
import { createSnapshotSource, createSpaceSources } from "./sources"
import { createSpaceStore, type SpaceStore } from "./store"
import { createSpaceTools, type SpaceTools, type SpaceToolsDeps } from "./tool"

export interface BotSpacesTables {
  readonly spaces: BotTable<SpaceRecord>
  readonly revisions: BotTable<SpaceRevision>
  readonly access: BotTable<SpaceAccessRecord>
  readonly kv: BotTable<SpaceKvRecord>
  readonly spaceSettings: BotTable<SpaceSettingsRecord>
}

export interface BotSpacesDeps {
  readonly tables: BotSpacesTables
  readonly blobIo: SpaceBlobIo
  sha256Hex(bytes: Uint8Array): string
  randomToken(): string
  readonly wrapperScriptHash: string
  place(botId: string): SpacePlace | undefined
  exists(botId: string): boolean
  bot(botId: string): { readonly name: string } | undefined
  avatar(botId: string): Promise<string>
  advertisedUrl(): string | undefined
  readonly notices: {
    enqueue(
      botId: string,
      notice: { readonly text: string; readonly summary: string },
      space: NoticeSpace,
    ): Promise<void>
    withdraw(matches: (space: NoticeSpace) => boolean): Promise<number>
    pending(spaceId: string): number
  }
  readonly tool: Pick<SpaceToolsDeps, "sealed" | "session" | "turn" | "homeShared">
  readonly approvals: {
    readonly visibility: OwnerApprovals
    readonly visitorWrites: OwnerApprovals
    readonly link: OwnerApprovals
  }
  newNonce(): string
  now(): number
  later(ms: number, work: () => void): () => void
  warn(message: string): void
}

export interface BotSpaces {
  readonly store: SpaceStore
  readonly access: SpaceAccess
  readonly manager: SpaceManager
  readonly tools: SpaceTools
  readonly panel: SpacesPanel
  handle(request: SpaceHttpRequest): Promise<SpaceHttpResponse>
  spaces(botId: string): readonly SpaceRecord[]
  onChange(listener: (botId: string) => void): () => void
  dispose(): void
}

export async function openBotSpaces(deps: BotSpacesDeps): Promise<BotSpaces> {
  const store = createSpaceStore(deps.tables)
  const blobs = await openSpaceBlobs({ io: deps.blobIo, sha256: deps.sha256Hex })
  const encoder = new TextEncoder()
  const access = createSpaceAccess({
    store,
    randomToken: deps.randomToken,
    sha256: (text) => deps.sha256Hex(encoder.encode(text)),
    now: deps.now,
  })
  const live = createSpaceLive({
    later: deps.later,
    valid: (subscriber) => access.stillValid(subscriber.access),
  })
  const kv = createSpaceKv({ store, live, now: deps.now })
  const events = createSpaceEvents({
    enqueue: deps.notices.enqueue,
    withdraw: deps.notices.withdraw,
    pending: deps.notices.pending,
    newNonce: deps.newNonce,
    later: deps.later,
    now: deps.now,
    warn: deps.warn,
  })
  const sources = createSpaceSources()
  sources.register(createSnapshotSource({ store, blobs }))
  const manager = createSpaceManager({
    store,
    blobs,
    access,
    live,
    events,
    kv,
    place: deps.place,
    now: deps.now,
    warn: deps.warn,
  })
  const tools = createSpaceTools({
    ...deps.tool,
    publicBaseUrl: () => store.settings()?.publicBaseUrl ?? null,
    approvals: deps.approvals,
    manager,
    store,
    access,
    kv,
    live,
  })
  const panel = createSpacesPanel({
    store,
    access,
    live,
    manager,
    exists: deps.exists,
    advertisedUrl: deps.advertisedUrl,
  })
  const http = createSpaceHttp({
    access,
    sources,
    kv,
    events,
    live,
    liveLimit: SPACE_LIMITS.liveStreams,
    bot: deps.bot,
    avatar: deps.avatar,
    wrapperScriptHash: deps.wrapperScriptHash,
  })
  await manager.forget(deps.exists)
  await manager.collect()
  return {
    store,
    access,
    manager,
    tools,
    panel,
    handle: (request) => http.handle(request),
    spaces: (botId) => store.list(botId),
    onChange: (listener) =>
      store.subscribe((change) => {
        if (change.kind !== "settings") listener(change.botId)
      }),
    dispose() {
      events.dispose()
      live.dispose()
    },
  }
}

export const spaceIdsOf = (spaces: readonly SpaceRecord[]) =>
  spaces.map((space) => spaceIdOf(space.botId, space.slug))
