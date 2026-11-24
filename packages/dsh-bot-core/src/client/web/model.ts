import type { BotWebCapability, BotWebTestResult, BotWebView } from "../../shared/web"
import { createStore, type Observable } from "../observable"
import { WebLookupError, type WebLookupFeed } from "./feed"

/** The connection test of the stored key: its result stays on the key's row for a while. */
export type WebTestState =
  | { readonly state: "idle" }
  | { readonly state: "running" }
  | { readonly state: "done"; readonly result: BotWebTestResult }
  | { readonly state: "failed"; readonly message: string }

/** What the section is doing apart from the streamed view: a switch being saved, a test. */
export interface WebLookupForm {
  /** The capability whose switch is being saved. */
  readonly saving: BotWebCapability | null
  /** Why the last switch change failed. */
  readonly error: string | null
  readonly test: WebTestState
}

export const IDLE_FORM: WebLookupForm = { saving: null, error: null, test: { state: "idle" } }

/** How long a test result replaces the key's pill. */
export const TEST_RESULT_MS = 8000

/** Every secret of the backend is stored. */
export function secretsSet(view: BotWebView): boolean {
  return view.backend?.secrets.every((secret) => secret.set) === true
}

/** The test tries the stored secrets: only when all are set and no test runs. */
export function canTest(view: BotWebView, form: WebLookupForm): boolean {
  return secretsSet(view) && form.test.state !== "running"
}

/** A capability's switch can change: the key is stored and no other switch is being saved. */
export function canSwitch(view: BotWebView, form: WebLookupForm): boolean {
  return secretsSet(view) && form.saving === null
}

/**
 * The section's working state over the shared feed; one per mounted section.
 * Saving a secret rejects with the feed's {@link WebLookupError}; the row
 * that typed it shows the message.
 */
export interface WebLookupModel extends Observable<WebLookupForm> {
  saveSecret(key: string, value: string): Promise<void>
  clearSecret(key: string): Promise<void>
  setEnabled(capability: BotWebCapability, enabled: boolean): Promise<void>
  test(): Promise<void>
  /** Take the test's result off the key's row. */
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
