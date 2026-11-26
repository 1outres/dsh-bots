import type {
  BotConnectorEnvironment,
  SecretBytes,
  VaultKit,
  VaultPasskey,
} from "@1outres/dsh-bot-core"
import { CDP_HOST_PORT, PASSKEY_HELPER } from "../vm/layout"
import { HelperFailureError } from "./failures"
import { type HelperRun, startHelper } from "./helper"
import { HelperProtocolError, type PasskeyOrder, type PasskeyRequest } from "./protocol"

export const PASSKEY_SECONDS = 60
const STEP_TIMEOUT_MS = 30_000

export interface PasskeySlotDeps {
  readonly environment: BotConnectorEnvironment
  readonly signal: AbortSignal
  readonly kit: VaultKit
  deadline(ms: number): AbortSignal
}

export interface PasskeyTab {
  readonly origin: string
  offer(passkey: VaultPasskey): Promise<void>
  cancel(): void
}

export interface PasskeySlot {
  locate(mark: string): Promise<PasskeyTab>
  release(): void
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")

export function passkeySlot(deps: PasskeySlotDeps): PasskeySlot {
  let current: HelperRun | undefined

  const release = () => {
    current?.terminate()
    current = undefined
  }

  const answer = async (run: HelperRun) => {
    const timeout = deps.deadline(STEP_TIMEOUT_MS)
    const timedOut = new Promise<never>((_, reject) => {
      timeout.addEventListener("abort", () => reject(new HelperFailureError("failed")), {
        once: true,
      })
    })
    const reply = await Promise.race([run.next(), timedOut])
    if (reply.kind === "error") throw new HelperFailureError(reply.code)
    return reply
  }

  const drain = async (run: HelperRun) => {
    try {
      for (;;) await run.next()
    } catch {
    } finally {
      if (current === run) current = undefined
    }
  }

  const order = (origin: string, passkey: VaultPasskey, length: number): PasskeyOrder => ({
    passkey: {
      origin,
      rpId: passkey.rpId,
      credentialId: base64(passkey.credentialId),
      ...(passkey.userHandle === undefined ? {} : { userHandle: base64(passkey.userHandle) }),
      signCount: passkey.signCount,
      seconds: PASSKEY_SECONDS,
      length,
    },
  })

  return {
    release,
    async locate(mark) {
      release()
      const run = await startHelper(deps.environment, PASSKEY_HELPER, deps.signal, deps.kit)
      current = run
      try {
        const request: PasskeyRequest = { devtools: CDP_HOST_PORT, mark }
        await run.send(request)
        const located = await answer(run)
        if (located.kind !== "located") throw new HelperProtocolError("out of order")
        return {
          origin: located.origin,
          async offer(passkey) {
            const key: SecretBytes = passkey.privateKey
            try {
              await run.sendSecret((length) => order(located.origin, passkey, length), key)
              const ready = await answer(run)
              if (ready.kind !== "ready") throw new HelperProtocolError("out of order")
              void drain(run)
            } catch (error) {
              if (current === run) release()
              throw error
            } finally {
              key.wipe()
            }
          },
          cancel() {
            if (current === run) release()
          },
        }
      } catch (error) {
        if (current === run) release()
        throw error
      }
    },
  }
}
