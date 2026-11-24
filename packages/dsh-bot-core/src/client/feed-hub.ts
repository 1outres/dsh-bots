import type { Observable } from "./observable"

/** A per-key model that streams while it lives. */
export interface FollowedModel<S> extends Observable<S> {
  dispose(): void
}

export interface FeedHubOptions<S, M extends FollowedModel<S>, Extra extends object> {
  /** What the feeds follow, in messages ("channels" reads "channels of "<key>" are not followed"). */
  readonly name: string
  /** The snapshot while nothing follows a key. */
  readonly idle: S
  open(key: string): M
  /** The feed's operations; `followed` throws while nothing follows the key. */
  extend(followed: () => M): Extra
}

/**
 * Per-key models shared by everything that shows them: one model per key,
 * opened by the first subscriber and disposed after the last. A key's feed is
 * the same object every time.
 */
export interface FeedHub<S, Extra extends object> {
  feed(key: string): Observable<S> & Extra
}

interface Entry<M> {
  readonly model: M
  subscribers: number
}

export function createFeedHub<S, M extends FollowedModel<S>, Extra extends object>(
  options: FeedHubOptions<S, M, Extra>,
): FeedHub<S, Extra> {
  const entries = new Map<string, Entry<M>>()
  const feeds = new Map<string, Observable<S> & Extra>()

  const acquire = (key: string): Entry<M> => {
    const existing = entries.get(key)
    if (existing !== undefined) {
      existing.subscribers += 1
      return existing
    }
    const entry = { model: options.open(key), subscribers: 1 }
    entries.set(key, entry)
    return entry
  }

  const release = (key: string, entry: Entry<M>) => {
    entry.subscribers -= 1
    if (entry.subscribers > 0) return
    entries.delete(key)
    entry.model.dispose()
  }

  const create = (key: string): Observable<S> & Extra => {
    const followed = (): M => {
      const entry = entries.get(key)
      if (entry === undefined) {
        throw new Error(`bot-core: ${options.name} of "${key}" are not followed`)
      }
      return entry.model
    }
    return {
      ...options.extend(followed),
      getSnapshot: () => entries.get(key)?.model.getSnapshot() ?? options.idle,
      subscribe(listener) {
        const entry = acquire(key)
        const off = entry.model.subscribe(listener)
        return () => {
          off()
          release(key, entry)
        }
      },
    }
  }

  return {
    feed(key) {
      const existing = feeds.get(key)
      if (existing !== undefined) return existing
      const feed = create(key)
      feeds.set(key, feed)
      return feed
    },
  }
}
