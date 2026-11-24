import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import { LAUNCHABLE_APPS } from "../agent/protocol"
import type { DesktopSession } from "../session"
import { elementId } from "./arguments"
import { argumentFields, type DesktopToolDeps, desktopTool } from "./define"

export function windowTools(deps: DesktopToolDeps): BotConnectorToolDefinition<DesktopSession>[] {
  return [
    desktopTool(
      {
        name: "windows",
        description:
          "List the desktop's windows (with ids for desktop_focus_window and as desktop_tree scope), the active one, the focused element and the screen size.",
        parameters: {},
        kind: "observe",
        preview: () => ({ title: "List the windows of the bot's desktop?", fields: [] }),
        async run(_args, run) {
          const status = await run.attachment.agent.call("status", {}, run.signal)
          const lines = status.windows.map(
            (window) =>
              `[${window.id}] ${window.app} ${window.role} ${JSON.stringify(window.name)}${window.active ? " active" : ""}`,
          )
          const focus =
            status.focus === null
              ? "none"
              : `${status.focus.role} ${JSON.stringify(status.focus.name)}`
          return {
            text: [
              `screen ${status.screen.width}x${status.screen.height}`,
              ...lines,
              `focus: ${focus}`,
            ].join("\n"),
          }
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "focus_window",
        description:
          "Bring a window to the front and give it the keyboard; window is an id from desktop_windows.",
        parameters: { window: { type: "string", required: true } },
        kind: "operate",
        preview: (args) => ({
          title: "Switch windows on the bot's desktop?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          const changes = await run.attachment.agent.call(
            "act",
            { id: elementId(args.window, "window"), action: "activate" },
            run.signal,
          )
          return { data: changes }
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "launch",
        description:
          "Start an application on the desktop: writer, calc, impress (LibreOffice), chrome (Google Chrome: a new window of the desktop's one Chrome, the browser connector's too), terminal (xfce4-terminal) or files (Thunar). args are files to open or a URL (no options). Answers the windows that opened.",
        parameters: {
          app: { type: "string", enum: LAUNCHABLE_APPS, required: true },
          args: { type: "array", items: { type: "string" } },
        },
        kind: "operate",
        preview: (args) => ({
          title: `Start ${args.app} on the bot's desktop?`,
          fields: argumentFields(args),
        }),
        async run(args, run) {
          const extra = args.args ?? []
          if (
            extra.length > 8 ||
            extra.some((arg) => arg.length === 0 || arg.length > 2_000 || arg.startsWith("-"))
          ) {
            throw new Error("args are at most 8 files or URLs, none starting with -")
          }
          const launched = await run.attachment.agent.call(
            "launch",
            { app: args.app, args: extra },
            run.signal,
          )
          return {
            data: {
              opened: launched.opened,
              activeWindow: launched.active_window,
              focus: launched.focus,
            },
            ...(launched.opened.length === 0
              ? {
                  text: "No new window appeared within 20 s; check desktop_windows before launching again.",
                }
              : {}),
          }
        },
      },
      deps,
    ),
  ]
}
