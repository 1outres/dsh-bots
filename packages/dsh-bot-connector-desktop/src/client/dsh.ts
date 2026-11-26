import type { ComponentType } from "react"

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface ClientContext {
  effect(effect: () => () => void, label?: string): void
  readonly slots: {
    inject(key: string, register: () => () => void): () => void
    // biome-ignore lint/suspicious/noExplicitAny: -
    register(options: Record<string, unknown>, component: ComponentType<any>): () => void
  }
  readonly locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  }
}
