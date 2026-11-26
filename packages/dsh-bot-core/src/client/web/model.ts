import type { BotWebCapability, BotWebTestResult, BotWebView } from "../../shared/web"
import { createStore, type Observable } from "../observable"
import { WebLookupError, type WebLookupFeed } from "./feed"

export type WebTestState =
  | { readonly state: "idle" }
  | { readonly state: "running" }
  | { readonly state: "done"; readonly result: BotWebTestResult }
  | { readonly state: "failed"; readonly message: string }

export interface WebLookupForm {
  readonly saving: BotWebCapability | null
  readonly error: string | null
  readonly test: WebTestState
}

export const IDLE_FORM: WebLookupForm = { saving: null, error: null, test: { state: "idle" } }

export const TEST_RESULT_MS = 8000

export function secretsSet(view: BotWebView): boolean {
  return view.backend?.secrets.every((secret) => secret.set) === true
}

export function canTest(view: BotWebView, form: WebLookupForm): boolean {
  return secretsSet(view) && form.test.state !== "running"
}

export function canSwitch(view: BotWebView, form: WebLookupForm): boolean {
  return secretsSet(view) && form.saving === null
}

export interface WebLookupModel extends Observable<WebLookupForm> {
  saveSecret(key: string, value: string): Promise<void>
  clearSecret(key: string): Promise<void>
  setEnabled(capability: BotWebCapability, enabled: boolean): Promise<void>
  test(): Promise<void>
  settleTest(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createWebLookupModel(feed: WebLookupFeed): WebLookupModel {
  const form = createStore<WebLookupForm>(IDLE_FORM)
  const patch = (change: Partial<WebLookupForm>) =>
    form.update((current) => ({ ...current, ...change }))
  const idleTest = () => patch({ test: { state: "idle" } })
  return {
    getSnapshot: form.getSnapshot,
    subscribe: form.subscribe,
    async saveSecret(key, value) {
      await feed.setSecret(key, { op: "set", value: value.trim() })
      idleTest()
    },
    async clearSecret(key) {
      await feed.setSecret(key, { op: "clear" })
      idleTest()
    },
    async setEnabled(capability, enabled) {
      if (form.getSnapshot().saving !== null) return
      patch({ saving: capability, error: null })
      try {
        await feed.setEnabled(capability, enabled)
        patch({ saving: null })
      } catch (error) {
        patch({ saving: null, error: messageOf(error) })
      }
    },
    async test() {
      if (form.getSnapshot().test.state === "running") return
      patch({ test: { state: "running" } })
      try {
        patch({ test: { state: "done", result: await feed.test() } })
      } catch (error) {
        patch({
          test: {
            state: "failed",
            message: error instanceof WebLookupError ? error.message : messageOf(error),
          },
        })
      }
    },
    settleTest() {
      const { test } = form.getSnapshot()
      if (test.state === "done" || test.state === "failed") idleTest()
    },
  }
}
