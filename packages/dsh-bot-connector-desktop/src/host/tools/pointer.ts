import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import {
  type AgentInput,
  type AgentResult,
  BUTTONS,
  MODIFIERS,
  SCROLL_DIRECTIONS,
} from "../agent/protocol"
import { toModel } from "../frame"
import type { DesktopSession } from "../session"
import { between, expectation, pointParameters, resolvePoint } from "./arguments"
import { argumentFields, type DesktopRun, type DesktopToolDeps, desktopTool } from "./define"

const COORDINATES =
  "Give x and y in the latest desktop_screenshot's image, or an element id (its centre); prefer desktop_act on elements from desktop_tree where it works."
const BUTTON = { type: "string", enum: BUTTONS, description: "Default left." } as const

export async function sendInput(
  run: DesktopRun,
  input: AgentInput,
  expected: { expect_screen?: { width: number; height: number } },
) {
  const result = await run.attachment.agent.call("input", { ...input, ...expected }, run.signal)
  return { data: inputData(run, result) }
}

export function inputData(run: DesktopRun, result: AgentResult<"input">) {
  const frame = run.attachment.frames.current()
  const pointer = result.pointer
  return {
    ...(result.via === undefined ? {} : { via: result.via }),
    ...(pointer === undefined
      ? {}
      : {
          pointer: {
            screen: pointer,
            screenshot: (frame === undefined ? undefined : toModel(frame, pointer)) ?? null,
          },
        }),
    activeWindow: result.active_window,
    focus: result.focus,
  }
}

export function pointerTools(deps: DesktopToolDeps): BotConnectorToolDefinition<DesktopSession>[] {
  const preview = (title: string) => (args: object) => ({ title, fields: argumentFields(args) })
  return [
    desktopTool(
      {
        name: "click",
        description: `Click with the mouse. ${COORDINATES} count 2 double-clicks; modifiers are held during the click.`,
        parameters: {
          ...pointParameters("", "the click"),
          button: BUTTON,
          count: { type: "integer", description: "1 to 3. Default 1." },
          modifiers: { type: "array", items: { type: "string", enum: MODIFIERS } },
        },
        kind: "operate",
        preview: preview("Click on the bot's desktop?"),
        async run(args, run) {
          const point = resolvePoint(args, run.attachment.frames, "the click")
          return sendInput(
            run,
            {
              kind: "click",
              at: point.at,
              button: args.button ?? "left",
              count: between("count", args.count ?? 1, 1, 3),
              modifiers: args.modifiers ?? [],
            },
            expectation(point),
          )
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "move",
        description: `Move the mouse pointer (to hover). ${COORDINATES}`,
        parameters: pointParameters("", "the pointer"),
        kind: "operate",
        preview: preview("Move the pointer on the bot's desktop?"),
        async run(args, run) {
          const point = resolvePoint(args, run.attachment.frames, "the pointer")
          return sendInput(run, { kind: "move", at: point.at }, expectation(point))
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "drag",
        description: `Press a mouse button at one point, move to another and release. ${COORDINATES}`,
        parameters: {
          ...pointParameters("from_", "the start"),
          ...pointParameters("to_", "the end"),
          button: BUTTON,
        },
        kind: "operate",
        preview: preview("Drag on the bot's desktop?"),
        async run(args, run) {
          const frames = run.attachment.frames
          const from = resolvePoint(
            { x: args.from_x, y: args.from_y, element: args.from_element },
            frames,
            "the start",
          )
          const to = resolvePoint(
            { x: args.to_x, y: args.to_y, element: args.to_element },
            frames,
            "the end",
          )
          return sendInput(
            run,
            { kind: "drag", from: from.at, to: to.at, button: args.button ?? "left" },
            expectation(from, to),
          )
        },
      },
      deps,
    ),
    ...(["mouse_down", "mouse_up"] as const).map((kind) =>
      desktopTool(
        {
          name: kind,
          description: `${kind === "mouse_down" ? "Press and hold" : "Release"} a mouse button at a point (for drags desktop_drag cannot do). ${COORDINATES}`,
          parameters: { ...pointParameters("", "the pointer"), button: BUTTON },
          kind: "operate",
          preview: preview(
            `${kind === "mouse_down" ? "Press" : "Release"} a mouse button on the bot's desktop?`,
          ),
          async run(args, run) {
            const point = resolvePoint(args, run.attachment.frames, "the pointer")
            return sendInput(
              run,
              { kind, at: point.at, button: args.button ?? "left" },
              expectation(point),
            )
          },
        },
        deps,
      ),
    ),
    desktopTool(
      {
        name: "scroll",
        description: `Turn the mouse wheel over a point. ${COORDINATES} amount is in wheel steps (1 to 30, default 3).`,
        parameters: {
          ...pointParameters("", "the pointer"),
          direction: { type: "string", enum: SCROLL_DIRECTIONS, required: true },
          amount: { type: "integer" },
        },
        kind: "operate",
        preview: preview("Scroll on the bot's desktop?"),
        async run(args, run) {
          const point = resolvePoint(args, run.attachment.frames, "the pointer")
          return sendInput(
            run,
            {
              kind: "scroll",
              at: point.at,
              direction: args.direction,
              amount: between("amount", args.amount ?? 3, 1, 30),
            },
            expectation(point),
          )
        },
      },
      deps,
    ),
  ]
}
