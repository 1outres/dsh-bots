import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import {
  type BotSpaceDiscarded,
  type BotSpaceErrorCode,
  type BotSpaceErrorDetails,
  type BotSpaceFrame,
  type BotSpaceLinkCreated,
  type BotSpacesSettings,
  type BotSpacesView,
  type BotSpaceView,
  contentPathOf,
  isSpaceVisibility,
  linkIdOf,
  parsePublicBaseUrl,
  parseSpaceId,
  publicUrlOf,
  SPACE_LIMITS,
  type SpaceRecord,
  spaceIdOf,
  wrapperPathOf,
} from "../../shared/spaces"
import type { RemoteCaller } from "../connectors/approvals"
import type { SpaceAccess } from "./access"
import type { SpaceLive } from "./live"
import type { SpaceManager } from "./manage"
import type { SpaceStore } from "./store"

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap extends BotSpaceErrorDetails {}
}

export interface SpacesPanel {
  view(caller: RemoteCaller | undefined): BotSpacesView
  frame(caller: RemoteCaller | undefined, spaceId: unknown): Promise<BotSpaceFrame>
  setPinned(
    caller: RemoteCaller | undefined,
    spaceId: unknown,
    pinned: unknown,
  ): Promise<BotSpaceView>
  setVisibility(
    caller: RemoteCaller | undefined,
    spaceId: unknown,
    visibility: unknown,
  ): Promise<BotSpaceView>
  setVisitorWrites(
    caller: RemoteCaller | undefined,
    spaceId: unknown,
    allowed: unknown,
  ): Promise<BotSpaceView>
  createLink(
    caller: RemoteCaller | undefined,
    spaceId: unknown,
    request: unknown,
  ): Promise<BotSpaceLinkCreated>
  revokeLink(
    caller: RemoteCaller | undefined,
    spaceId: unknown,
    linkId: unknown,
  ): Promise<BotSpaceView>
  discard(caller: RemoteCaller | undefined, spaceId: unknown): Promise<BotSpaceDiscarded>
  setPublicBaseUrl(caller: RemoteCaller | undefined, url: unknown): Promise<BotSpacesSettings>
  subscribe(listener: () => void): () => void
}

export interface SpacesPanelDeps {
  readonly store: Pick<
    SpaceStore,
    "list" | "get" | "revision" | "kvStats" | "settings" | "setSettings" | "subscribe"
  >
  readonly access: Pick<SpaceAccess, "frame" | "links" | "publicToken">
  readonly live: Pick<SpaceLive, "count" | "subscribe">
  readonly manager: SpaceManager
  exists(botId: string): boolean
  advertisedUrl(): string | undefined
}

const refuse = (code: BotSpaceErrorCode, message: string) => new RemoteError(code, message, {})

const bad = (message: string) => new RemoteError("gateway/bad-request", message, {})

export function createSpacesPanel(deps: SpacesPanelDeps): SpacesPanel {
  const owner = (caller: RemoteCaller | undefined) => {
    if (caller?.kind !== "owner")
      throw refuse("bot-space/not-owner", "only the owner of this DSH manages Spaces")
  }

  const require = (spaceId: unknown): SpaceRecord => {
    const parsed = parseSpaceId(spaceId)
    const space =
      parsed === undefined ? undefined : deps.store.get(spaceIdOf(parsed.botId, parsed.slug))
    if (space === undefined || !deps.exists(space.botId))
      throw refuse("bot-space/not-found", "no such space")
    return space
  }

  const baseUrl = () => deps.store.settings()?.publicBaseUrl ?? null

  const settings = (): BotSpacesSettings => {
    const advertised = deps.advertisedUrl()
    const parsed = advertised === undefined ? undefined : parsePublicBaseUrl(advertised)
    return { publicBaseUrl: baseUrl(), suggestedBaseUrl: parsed?.ok === true ? parsed.url : null }
  }

  const viewOf = (space: SpaceRecord): BotSpaceView => {
    const spaceId = spaceIdOf(space.botId, space.slug)
    const revision =
      space.source.revision === null
        ? undefined
        : deps.store.revision(spaceId, space.source.revision)
    const base = baseUrl()
    const token = deps.access.publicToken(spaceId)
    return {
      id: spaceId,
      botId: space.botId,
      slug: space.slug,
      title: space.title,
      description: space.description,
      pinned: space.pinned,
      visibility: space.visibility,
      visitorWrites: space.visitorWrites,
      revision:
        revision === undefined
          ? null
          : {
              number: revision.number,
              publishedAt: revision.publishedAt,
              files: Object.keys(revision.files).length,
              bytes: Object.values(revision.files).reduce((sum, file) => sum + file.bytes, 0),
            },
      links: deps.access.links(spaceId).map(([hash, record]) => ({
        id: linkIdOf(hash),
        label: record.label,
        issuedBy: record.issuedBy,
        reason: record.reason,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt as number,
      })),
      publicUrl: base === null || token === undefined ? null : publicUrlOf(base, token),
      kv: deps.store.kvStats(spaceId),
      viewers: deps.live.count(spaceId),
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
    }
  }

  const fresh = (space: SpaceRecord) => viewOf(require(spaceIdOf(space.botId, space.slug)))

  return {
    view(caller) {
      owner(caller)
      return {
        spaces: deps.store
          .list()
          .filter((space) => deps.exists(space.botId))
          .map(viewOf),
        settings: settings(),
      }
    },
    async frame(caller, spaceId) {
      owner(caller)
      const space = require(spaceId)
      const grant = deps.access.frame(spaceIdOf(space.botId, space.slug))
      return { url: contentPathOf(grant.token), expiresAt: grant.expiresAt as number }
    },
    async setPinned(caller, spaceId, pinned) {
      owner(caller)
      const space = require(spaceId)
      if (typeof pinned !== "boolean") throw bad("pinned must be true or false")
      await deps.manager.update(spaceIdOf(space.botId, space.slug), { pinned })
      return fresh(space)
    },
    async setVisibility(caller, spaceId, visibility) {
      owner(caller)
      const space = require(spaceId)
      if (!isSpaceVisibility(visibility)) throw bad('visibility must be "owner" or "public"')
      await deps.manager.setVisibility(spaceIdOf(space.botId, space.slug), visibility, "owner")
      return fresh(space)
    },
    async setVisitorWrites(caller, spaceId, allowed) {
      owner(caller)
      const space = require(spaceId)
      if (typeof allowed !== "boolean") throw bad("allowed must be true or false")
      await deps.manager.setVisitorWrites(spaceIdOf(space.botId, space.slug), allowed)
      return fresh(space)
    },
    async createLink(caller, spaceId, request) {
      owner(caller)
      const space = require(spaceId)
      if (typeof request !== "object" || request === null)
        throw bad("request must be { label, days }")
      const { label, days } = request as { label?: unknown; days?: unknown }
      if (
        typeof label !== "string" ||
        label.trim() === "" ||
        label.trim().length > SPACE_LIMITS.labelLength
      ) {
        throw bad(`label must be 1-${SPACE_LIMITS.labelLength} characters`)
      }
      if (
        typeof days !== "number" ||
        !Number.isInteger(days) ||
        days < 1 ||
        days > SPACE_LIMITS.linkDaysMax
      ) {
        throw bad(`days must be a whole number from 1 to ${SPACE_LIMITS.linkDaysMax}`)
      }
      const grant = await deps.manager.link(spaceIdOf(space.botId, space.slug), {
        label: label.trim(),
        days,
        reason: null,
        issuedBy: "owner",
      })
      const base = baseUrl()
      return {
        id: linkIdOf(grant.hash),
        url: base === null ? null : publicUrlOf(base, grant.token),
        relativeUrl: wrapperPathOf(grant.token),
        expiresAt: grant.expiresAt as number,
      }
    },
    async revokeLink(caller, spaceId, linkId) {
      owner(caller)
      const space = require(spaceId)
      if (typeof linkId !== "string") throw bad("linkId must be text")
      const revoked = await deps.manager.revokeLink(spaceIdOf(space.botId, space.slug), linkId)
      if (!revoked) throw refuse("bot-space/not-found", "no such link")
      return fresh(space)
    },
    async discard(caller, spaceId) {
      owner(caller)
      const space = require(spaceId)
      await deps.manager.discard(spaceIdOf(space.botId, space.slug))
      return { discarded: true }
    },
    async setPublicBaseUrl(caller, url) {
      owner(caller)
      if (url === null) {
        await deps.store.setSettings({ publicBaseUrl: null })
        return settings()
      }
      if (typeof url !== "string") throw bad("url must be text or null")
      const parsed = parsePublicBaseUrl(url)
      if (!parsed.ok) throw refuse("bot-space/invalid-base-url", parsed.reason)
      await deps.store.setSettings({ publicBaseUrl: parsed.url })
      return settings()
    },
    subscribe(listener) {
      const offs = [deps.store.subscribe(() => listener()), deps.live.subscribe(() => listener())]
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
