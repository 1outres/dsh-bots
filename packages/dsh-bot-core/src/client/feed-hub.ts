import type { Observable } from "./observable"

export interface FollowedModel<S> extends Observable<S> {
  dispose(): void
}

export interface FeedHubOptions<S, M extends FollowedModel<S>, Extra extends object> {
  readonly name: string
  readonly idle: S
  open(key: string): M
  extend(followed: () => M): Extra
}

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
