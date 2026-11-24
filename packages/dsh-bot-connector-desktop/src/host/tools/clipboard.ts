import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import type { DesktopSession } from "../session"
import { between } from "./arguments"
import { type DesktopToolDeps, desktopTool } from "./define"

const MAX_CLIPBOARD = 100_000

export function clipboardTools(
  deps: DesktopToolDeps,
): BotConnectorToolDefinition<DesktopSession>[] {
  return [
    desktopTool(
      {
        name: "clipboard_get",
        description: "Read the desktop's clipboard as text (limit characters, default 20000).",
        parameters: { limit: { type: "integer" } },
        kind: "observe",
        preview: () => ({ title: "Read the clipboard of the bot's desktop?", fields: [] }),
        async run(args, run) {
          const clip = await run.attachment.agent.call(
            "clipboard_get",
            { limit: between("limit", args.limit ?? 20_000, 1, 20_000) },
            run.signal,
          )
          return {
            text: clip.text,
            data: { length: clip.length, truncated: clip.length > clip.text.length },
          }
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "clipboard_set",
        description: "Put text on the desktop's clipboard (then paste it with desktop_key ctrl+v).",
        parameters: { text: { type: "string", required: true } },
        kind: "operate",
        preview: (args) => ({
          title: "Set the clipboard of the bot's desktop?",
          fields: [],
          body: args.text,
        }),
        async run(args, run) {
          if (args.text.length > MAX_CLIPBOARD)
            throw new Error(`text is longer than ${MAX_CLIPBOARD} characters`)
          return {
            data: await run.attachment.agent.call("clipboard_set", { text: args.text }, run.signal),
          }
        },
      },
      deps,
    ),
  ]
}
