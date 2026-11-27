import { describe, expect, it } from "vitest"
import type { MainInputClient } from "../src/client/main-input/client"
import {
  EMPTY_DRAFT,
  sendableOf,
  uploadFailed,
  uploadStaged,
  withAttachments,
  withText,
} from "../src/client/main-input/draft"
import { keyIntent } from "../src/client/main-input/keys"
import { createMainComposerModel } from "../src/client/main-input/model"
import {
  availabilityOf,
  connectionLost,
  INITIAL_COMPOSER,
  primaryActionOf,
  stateReceived,
} from "../src/client/main-input/state"
import { base64Of, type UploadSource, uploadAttachment } from "../src/client/main-input/uploads"
import { createStore } from "../src/client/observable"
import type { BotsState } from "../src/client/session-classification"
import { showsCurrentMain } from "../src/client/wiring/main-composer"
import type { MainInputState, MainInputSubmission } from "../src/shared/main-input"

const KEY = {
  key: "Enter",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  keyCode: 13,
}

const STATE: MainInputState = {
  botId: "a",
  mainSessionId: "m1",
  activity: "idle",
  limits: { maxCount: 10, maxFileBytes: 100, maxMessageBytes: 200, chunkBytes: 4 },
}

const file = (name: string, text: string, type = "text/plain"): UploadSource => {
  const data = new TextEncoder().encode(text)
  return {
    name,
    type,
    size: data.byteLength,
    slice: (start, end) => ({ arrayBuffer: async () => data.slice(start, end).buffer }),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("Main composer keys", () => {
  it("sends on a plain Enter only", () => {
    expect(keyIntent(KEY)).toBe("submit")
    expect(keyIntent({ ...KEY, shiftKey: true })).toBe("type")
    expect(keyIntent({ ...KEY, metaKey: true })).toBe("type")
    expect(keyIntent({ ...KEY, key: "a" })).toBe("type")
  })

  it("never sends the Enter that confirms an IME composition", () => {
    expect(keyIntent({ ...KEY, isComposing: true })).toBe("type")
    expect(keyIntent({ ...KEY, keyCode: 229 })).toBe("type")
  })
})

describe("Main composer draft", () => {
  const attachment = (key: string) => ({
    key,
    name: key,
    mediaType: "text/plain",
    bytes: 1,
    status: { kind: "uploading", sent: 0 } as const,
  })

  it("sends trimmed text, and attachments only once every one is staged", () => {
    expect(sendableOf(EMPTY_DRAFT)).toEqual({ ok: false, reason: "empty" })
    expect(sendableOf(withText(EMPTY_DRAFT, "  "))).toEqual({ ok: false, reason: "empty" })
    expect(sendableOf(withText(EMPTY_DRAFT, " hi "))).toEqual({
      ok: true,
      submission: { text: "hi", attachments: [] },
    })
    const draft = withAttachments(EMPTY_DRAFT, [attachment("x"), attachment("y")])
    expect(sendableOf(draft)).toEqual({ ok: false, reason: "uploading" })
    const staged = uploadStaged(uploadStaged(draft, "x", "s1"), "y", "s2")
    expect(sendableOf(staged)).toEqual({
      ok: true,
      submission: { text: "", attachments: ["s1", "s2"] },
    })
    expect(sendableOf(uploadFailed(staged, "y", "no"))).toEqual({ ok: false, reason: "failed" })
  })
})

describe("Main composer state", () => {
  it("offers Stop while the Main runs and the draft is empty, Send otherwise", () => {
    const running = stateReceived(INITIAL_COMPOSER, { ...STATE, activity: "running" })
    expect(primaryActionOf(running, false)).toEqual({ kind: "stop", enabled: true })
    expect(primaryActionOf({ ...running, draft: withText(EMPTY_DRAFT, "next") }, false)).toEqual({
      kind: "send",
      enabled: true,
    })
    expect(primaryActionOf({ ...running, sending: true }, false)).toEqual({ kind: "sending" })
    const idle = stateReceived(INITIAL_COMPOSER, STATE)
    expect(primaryActionOf(idle, false)).toEqual({ kind: "send", enabled: false })
    expect(primaryActionOf({ ...idle, draft: withText(EMPTY_DRAFT, "x") }, true)).toEqual({
      kind: "send",
      enabled: false,
    })
  })

  it("is unavailable while connecting, without a Main, and after a failure", () => {
    expect(availabilityOf(INITIAL_COMPOSER)).toEqual({ kind: "unavailable", reason: "connecting" })
    const { mainSessionId: _, ...noMain } = STATE
    expect(availabilityOf(stateReceived(INITIAL_COMPOSER, noMain))).toEqual({
      kind: "unavailable",
      reason: "no-main",
    })
    const ready = stateReceived(INITIAL_COMPOSER, STATE)
    expect(connectionLost(ready, "x").connection).toEqual({ status: "reconnecting", state: STATE })
    expect(availabilityOf(connectionLost(INITIAL_COMPOSER, "gone"))).toEqual({
      kind: "unavailable",
      reason: "failed",
    })
  })
})

describe("Main composer uploads", () => {
  it("encodes bytes as base64", () => {
    expect(base64Of(new TextEncoder().encode("hello"))).toBe("aGVsbG8=")
  })

  it("stages a file and sends it in chunks of the Host's size, in order", async () => {
    const appended: [number, string][] = []
    const progress: number[] = []
    const outcome = await uploadAttachment(
      {
        stage: async (_botId, request) => {
          expect(request).toEqual({
            draft: "d1",
            name: "n.txt",
            mediaType: "text/plain",
            bytes: 10,
          })
          return { staged: true, attachmentId: "s1" }
        },
        append: async (_botId, _id, offset, data) => {
          appended.push([offset, atob(data)])
          return { appended: true, received: offset + atob(data).length, complete: false }
        },
        discard: async () => true,
      },
      {
        botId: "a",
        draft: "d1",
        file: file("n.txt", "0123456789"),
        chunkBytes: 4,
        signal: new AbortController().signal,
        progress: (sent) => progress.push(sent),
      },
    )
    expect(outcome).toEqual({ ok: true, attachmentId: "s1" })
    expect(appended).toEqual([
      [0, "0123"],
      [4, "4567"],
      [8, "89"],
    ])
    expect(progress).toEqual([4, 8, 10])
  })

  it("discards a staged file the Host refused part of", async () => {
    const discarded: string[] = []
    const outcome = await uploadAttachment(
      {
        stage: async () => ({ staged: true, attachmentId: "s1" }),
        append: async () => ({ appended: false, failure: { code: "too-large", message: "big" } }),
        discard: async (_botId, id) => {
          discarded.push(id)
          return true
        },
      },
      {
        botId: "a",
        draft: "d1",
        file: file("n", "abc"),
        chunkBytes: 4,
        signal: new AbortController().signal,
        progress: () => {},
      },
    )
    expect(outcome).toEqual({ ok: false, failure: { code: "too-large", message: "big" } })
    expect(discarded).toEqual(["s1"])
  })
})

function fakeClient() {
  const sent: MainInputSubmission[] = []
  const discarded: string[] = []
  const stopped: string[] = []
  let stage = 0
  let answer: "sent" | "refused" = "sent"
  const states: ((state: MainInputState) => void)[] = []
  const client: MainInputClient = {
    generation: createStore<object | undefined>({}),
    async watch() {
      return () => {
        const queue: MainInputState[] = []
        let wake: (() => void) | undefined
        states.push((state) => {
          queue.push(state)
          wake?.()
        })
        return {
          dispose() {},
          async *[Symbol.asyncIterator]() {
            for (;;) {
              const next = queue.shift()
              if (next !== undefined) {
                yield next
                continue
              }
              await new Promise<void>((resolve) => {
                wake = resolve
              })
            }
          },
        }
      }
    },
    stage: async () => ({ staged: true, attachmentId: `s${++stage}` }),
    append: async (_botId, _id, offset, data) => ({
      appended: true,
      received: offset + atob(data).length,
      complete: true,
    }),
    async discard(_botId, id) {
      discarded.push(id)
      return true
    },
    async send(_botId, submission) {
      sent.push(submission)
      return answer === "sent"
        ? { sent: true, sessionId: "m1", mode: "queue" }
        : { sent: false, failure: { code: "rejected", message: "refused" } }
    },
    async stop(botId) {
      stopped.push(botId)
      return { ok: true, outcome: "stopped" }
    },
  }
  return {
    client,
    sent,
    discarded,
    stopped,
    push: (state: MainInputState) => {
      for (const push of states) push(state)
    },
    refuse: () => {
      answer = "refused"
    },
  }
}

const TEXTS = {
  notReady: () => "not ready",
  uploading: () => "uploading",
  failedAttachment: () => "failed",
}
const PREVIEWS = { create: () => undefined, revoke: () => {} }

describe("Main composer model", () => {
  it("keeps the draft while nobody watches, and sends it with its staged files", async () => {
    const fake = fakeClient()
    const model = createMainComposerModel(
      { client: fake.client, texts: TEXTS, previews: PREVIEWS, newDraftId: () => "d1" },
      "a",
    )
    const off = model.subscribe(() => {})
    await settle()
    fake.push(STATE)
    await settle()
    model.setText("hello")
    model.addFiles([file("n.txt", "abc")])
    await settle()
    await settle()
    off()
    expect(model.getSnapshot().draft.text).toBe("hello")
    expect(model.getSnapshot().draft.attachments[0]?.status).toEqual({
      kind: "ready",
      attachmentId: "s1",
    })
    model.subscribe(() => {})
    await settle()
    fake.push(STATE)
    await settle()
    expect(await model.send()).toBe(true)
    expect(fake.sent).toEqual([{ text: "hello", attachments: ["s1"] }])
    expect(model.getSnapshot().draft).toEqual(EMPTY_DRAFT)
  })

  it("keeps the draft and shows why when the Host refuses it", async () => {
    const fake = fakeClient()
    const model = createMainComposerModel(
      { client: fake.client, texts: TEXTS, previews: PREVIEWS, newDraftId: () => "d1" },
      "a",
    )
    model.subscribe(() => {})
    await settle()
    fake.push(STATE)
    await settle()
    fake.refuse()
    model.setText("x")
    expect(await model.send()).toBe(false)
    expect(model.getSnapshot()).toMatchObject({ notice: "refused", sending: false })
    expect(model.getSnapshot().draft.text).toBe("x")
    model.setText("xy")
    expect(model.getSnapshot().notice).toBeUndefined()
  })

  it("discards a removed staged file and refuses files before the Host answers", async () => {
    const fake = fakeClient()
    const model = createMainComposerModel(
      { client: fake.client, texts: TEXTS, previews: PREVIEWS, newDraftId: () => "d1" },
      "a",
    )
    model.subscribe(() => {})
    model.addFiles([file("early", "a")])
    expect(model.getSnapshot()).toMatchObject({ notice: "not ready", draft: EMPTY_DRAFT })
    await settle()
    fake.push(STATE)
    await settle()
    model.addFiles([file("n", "a")])
    await settle()
    await settle()
    const [attachment] = model.getSnapshot().draft.attachments
    model.removeAttachment(attachment?.key ?? "")
    expect(fake.discarded).toEqual(["s1"])
    expect(model.getSnapshot().draft.attachments).toEqual([])
  })

  it("stops the running turn", async () => {
    const fake = fakeClient()
    const model = createMainComposerModel(
      { client: fake.client, texts: TEXTS, previews: PREVIEWS, newDraftId: () => "d1" },
      "a",
    )
    model.stop()
    await settle()
    expect(fake.stopped).toEqual(["a"])
    expect(model.getSnapshot().stopping).toBe(false)
  })
})

describe("Main composer seat", () => {
  const bots: BotsState = {
    status: "ready",
    snapshot: { bots: [{ id: "a", mainSessionId: "m1" }], pending: [] } as never,
  }
  it("is wanted only while the shown session is a bot's current Main", () => {
    expect(showsCurrentMain({ kind: "session", sessionId: "m1" }, bots)).toBe(true)
    expect(showsCurrentMain({ kind: "session", sessionId: "s1" }, bots)).toBe(false)
    expect(showsCurrentMain({ kind: "none" }, bots)).toBe(false)
    expect(showsCurrentMain({ kind: "session", sessionId: "m1" }, { status: "loading" })).toBe(
      false,
    )
  })
})
