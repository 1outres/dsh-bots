/**
 * desktop_request_handoff: the bot asks a person to take over its desktop
 * (to log in, type a password, solve a check) and waits until they hand it
 * back, turn it down, the wait runs out, or the turn stops. The request shows
 * in the bot's shell (bot-core reads it from the connector's status).
 */
import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import type { ControlChange, ControlReturn, DesktopControl } from "../control"
import type { DesktopSession } from "../session"
import { between } from "./arguments"
import { type DesktopToolDeps, desktopTool } from "./define"

export const DEFAULT_HANDOFF_MINUTES = 10
export const MAX_HANDOFF_MINUTES = 30
const MAX_REASON = 500

export type HandoffOutcome =
  | { readonly kind: "returned"; readonly how: ControlReturn; readonly tookMs: number }
  | { readonly kind: "declined" }
  | { readonly kind: "timed-out"; readonly personInControl: boolean }

export interface HandoffDeps {
  readonly control: DesktopControl
  /** A signal that aborts after `ms`. */
  deadline(ms: number): AbortSignal
  now(): number
}

/** Ask, then wait for the outcome; the request ends with the wait. @throws when `signal` aborts. */
export async function awaitHandoff(
  deps: HandoffDeps,
  botId: string,
  reason: string,
  waitMs: number,
  signal: AbortSignal,
): Promise<HandoffOutcome> {
  const { control } = deps
  const request = control.request(botId, reason)
  let taken = control.view(botId).controller === "human"
  let takenAt = deps.now()
  const deadline = deps.deadline(waitMs)
  try {
    return await new Promise<HandoffOutcome>((resolve, reject) => {
      const finish = (outcome: HandoffOutcome | Error) => {
        off()
        signal.removeEventListener("abort", aborted)
        deadline.removeEventListener("abort", expired)
        if (outcome instanceof Error) reject(outcome)
        else resolve(outcome)
      }
      const off = control.subscribe((changed: string, change: ControlChange) => {
        if (changed !== botId) return
        switch (change.kind) {
          case "taken":
            if (!taken) takenAt = deps.now()
            taken = true
            break
          case "returned":
            if (taken) finish({ kind: "returned", how: change.how, tookMs: deps.now() - takenAt })
            break
          case "declined":
            if (change.requestId === request.id && !taken) finish({ kind: "declined" })
            break
        }
      })
      const aborted = () =>
        finish(signal.reason instanceof Error ? signal.reason : new Error("the turn stopped"))
      const expired = () =>
        finish({ kind: "timed-out", personInControl: control.view(botId).controller === "human" })
      if (signal.aborted) aborted()
      signal.addEventListener("abort", aborted, { once: true })
      deadline.addEventListener("abort", expired, { once: true })
    })
  } finally {
    control.endRequest(botId, request.id)
  }
}

export function outcomeText(outcome: HandoffOutcome): string {
  switch (outcome.kind) {
    case "returned":
      return outcome.how === "handed-back"
        ? `The person took over and handed the desktop back after ${Math.round(outcome.tookMs / 1000)} s. What they did is not reported: check the screen before continuing.`
        : `The person took over, then their viewer closed after ${Math.round(outcome.tookMs / 1000)} s, which gave the desktop back. They may not have finished: check the screen.`
    case "declined":
      return "The person turned the request down without taking over. Continue another way or ask them in the conversation."
    case "timed-out":
      return outcome.personInControl
        ? "The wait ran out while the person still operates the desktop; tools that change the screen fail with USER_IN_CONTROL until they hand it back. Do other work or call desktop_request_handoff again to wait longer."
        : "Nobody took over before the wait ran out. Tell the person in the conversation what you need, or call desktop_request_handoff again later."
  }
}

export function handoffTools(
  deps: DesktopToolDeps & Omit<HandoffDeps, "control">,
): BotConnectorToolDefinition<DesktopSession>[] {
  return [
    desktopTool(
      {
        name: "request_handoff",
        description:
          "Ask the person to take over this desktop for a step only they should do (log in, type a password or a one-time code, solve a captcha, confirm something with their own judgement), then wait until they hand it back (wait_minutes, default 10, at most 30). The request and your reason show in their bot window, where they watch the screen and take over. Say exactly what to do in reason. Never ask them to type secrets into the conversation instead.",
        parameters: {
          reason: { type: "string", required: true },
          wait_minutes: { type: "integer" },
        },
        kind: "observe",
        concurrent: true,
        preview: (args) => ({
          title: "Ask the person to take over the bot's desktop?",
          fields: [{ label: "Reason", value: args.reason }],
        }),
        async run(args, run) {
          const reason = args.reason.trim()
          if (reason === "") throw new Error("reason must say what the person should do")
          if (reason.length > MAX_REASON) {
            throw new Error(`reason is longer than ${MAX_REASON} characters`)
          }
          const minutes = between(
            "wait_minutes",
            args.wait_minutes ?? DEFAULT_HANDOFF_MINUTES,
            1,
            MAX_HANDOFF_MINUTES,
          )
          const outcome = await awaitHandoff(
            { control: deps.control, deadline: deps.deadline, now: deps.now },
            run.bot.id,
            reason,
            minutes * 60_000,
            run.signal,
          )
          return { text: outcomeText(outcome), data: { outcome: outcome.kind } }
        },
      },
      deps,
    ),
  ]
}
