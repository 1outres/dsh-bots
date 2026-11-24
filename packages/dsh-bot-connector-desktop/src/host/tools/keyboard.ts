import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import { KEY_COMBO, PASTE_COMBOS } from "../agent/protocol"
import type { DesktopSession } from "../session"
import { between } from "./arguments"
import { argumentFields, type DesktopToolDeps, desktopTool } from "./define"
import { sendInput } from "./pointer"

const MAX_TYPE = 20_000

function combo(value: string): string {
  if (!KEY_COMBO.test(value)) {
    throw new Error(
      `"${value}" is not a key like Return, ctrl+s, shift+Tab or alt+F4 (X keysym names joined with +)`,
    )
  }
  return value
}

export function keyboardTools(deps: DesktopToolDeps): BotConnectorToolDefinition<DesktopSession>[] {
  return [
    desktopTool(
      {
        name: "type",
        description:
          "Type text into the focused element (focus it first: desktop_act action focus, or a click). ASCII is typed key by key; text with other characters (Japanese…) is pasted through the clipboard, which it replaces. Line breaks press Return. In a terminal use paste ctrl+shift+v.",
        parameters: {
          text: { type: "string", required: true },
          paste: {
            type: "string",
            enum: PASTE_COMBOS,
            description: "Paste shortcut for non-ASCII text. Default ctrl+v.",
          },
        },
        kind: "operate",
        preview: (args) => ({ title: "Type on the bot's desktop?", fields: [], body: args.text }),
        async run(args, run) {
          if (args.text.length === 0 || args.text.length > MAX_TYPE) {
            throw new Error(`text must have 1 to ${MAX_TYPE} characters`)
          }
          return sendInput(
            run,
            { kind: "type", text: args.text, paste: args.paste ?? "ctrl+v" },
            {},
          )
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "key",
        description:
          "Press keys or shortcuts in order, e.g. ['ctrl+s'], ['Return'], ['ctrl+a', 'Delete'], ['alt+F4']. Names are X keysyms: Return, Tab, Escape, BackSpace, Delete, Home, End, Page_Up, Page_Down, Up, Down, Left, Right, F1…F12; modifiers ctrl, shift, alt, super.",
        parameters: { keys: { type: "array", items: { type: "string" }, required: true } },
        kind: "operate",
        preview: (args) => ({
          title: "Press keys on the bot's desktop?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          if (args.keys.length === 0 || args.keys.length > 32)
            throw new Error("keys must list 1 to 32 keys")
          return sendInput(run, { kind: "key", keys: args.keys.map(combo) }, {})
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "hold_key",
        description:
          "Hold a key or combination down for a while, then release it (duration_ms 10 to 10000).",
        parameters: {
          keys: {
            type: "string",
            required: true,
            description: "One key or combination, like shift or ctrl+Right.",
          },
          duration_ms: { type: "integer", required: true },
        },
        kind: "operate",
        preview: (args) => ({
          title: "Hold a key on the bot's desktop?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          return sendInput(
            run,
            {
              kind: "hold_key",
              keys: combo(args.keys),
              duration_ms: between("duration_ms", args.duration_ms, 10, 10_000),
            },
            {},
          )
        },
      },
      deps,
    ),
  ]
}
