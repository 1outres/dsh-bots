import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import { ACT_ACTIONS, BUTTONS } from "../agent/protocol"
import type { DesktopSession } from "../session"
import { between, ELEMENT_DESCRIPTION, elementId } from "./arguments"
import { argumentFields, type DesktopToolDeps, desktopTool } from "./define"

export const TREE_DEFAULTS = { maxNodes: 150, maxDepth: 12, maxText: 80 } as const
export const FIND_DEFAULTS = { limit: 20, visitBudget: 4_000 } as const
const TREE_RESULT_CHARS = 64_000

const scopeOf = (scope: string | undefined) =>
  scope === undefined || scope === "active" ? "active" : elementId(scope, "scope")

const SCOPE = {
  type: "string",
  description:
    "'active' (the active window, default) or a window or element id (desktop_windows lists the windows).",
} as const
const FORMAT = {
  type: "string",
  enum: ["text", "json"],
  description: "text (default): one line per element; json for code that filters.",
} as const

export function elementTools(deps: DesktopToolDeps): BotConnectorToolDefinition<DesktopSession>[] {
  return [
    desktopTool(
      {
        name: "tree",
        description:
          `Read what is on the screen as a tree of accessible elements — start here, before any screenshot. Each line is ` +
          `[id] role "name" text="…" value=… states (note); ids are for desktop_act, desktop_text, desktop_find scope and the pointer tools' element. ` +
          `Only elements showing are listed, structure without names is folded, and long texts are cut (read them with desktop_text). ` +
          `Ids stay valid for the 8 latest desktop_tree/desktop_find/desktop_windows calls; an older id fails with stale_element. ` +
          `Defaults: max_nodes ${TREE_DEFAULTS.maxNodes}, max_depth ${TREE_DEFAULTS.maxDepth}, max_text ${TREE_DEFAULTS.maxText}; "… N more not shown" means the budget ran out (narrow the scope or raise max_nodes). ` +
          "Spreadsheet cells: use desktop_sheet.",
        parameters: {
          scope: SCOPE,
          format: FORMAT,
          max_nodes: { type: "integer", description: "1 to 2000." },
          max_depth: { type: "integer", description: "1 to 64." },
          max_text: { type: "integer", description: "Characters of text per element, 8 to 4000." },
          geometry: { type: "boolean", description: "Add each element's screen rectangle." },
        },
        kind: "observe",
        maxResultChars: TREE_RESULT_CHARS,
        preview: (args) => ({
          title: "Read the screen of the bot's desktop?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          const tree = await run.attachment.agent.call(
            "tree",
            {
              scope: scopeOf(args.scope),
              format: args.format ?? "text",
              max_nodes: between("max_nodes", args.max_nodes ?? TREE_DEFAULTS.maxNodes, 1, 2_000),
              max_depth: between("max_depth", args.max_depth ?? TREE_DEFAULTS.maxDepth, 1, 64),
              max_text: between("max_text", args.max_text ?? TREE_DEFAULTS.maxText, 8, 4_000),
              geometry: args.geometry ?? false,
            },
            run.signal,
          )
          const head = `snapshot ${tree.snapshot}: ${tree.nodes} elements`
          return typeof tree.tree === "string"
            ? { text: `${head}\n${tree.tree}` }
            : { text: head, data: tree.tree }
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "find",
        description:
          `Search the active window (or scope) for elements by role (exact, like "push button", "entry", "menu item"), name and text (parts, any case) and states (all of them, like ["focused"]). ` +
          `Answers up to limit (default ${FIND_DEFAULTS.limit}) matches with ids, visiting at most ${FIND_DEFAULTS.visitBudget} elements (truncated: true when it stopped early). Hidden elements (closed menus) are not found: open them first.`,
        parameters: {
          scope: SCOPE,
          role: { type: "string" },
          name: { type: "string" },
          text: { type: "string" },
          states: { type: "array", items: { type: "string" } },
          limit: { type: "integer", description: "1 to 200." },
          format: FORMAT,
          geometry: { type: "boolean" },
        },
        kind: "observe",
        maxResultChars: TREE_RESULT_CHARS,
        preview: (args) => ({
          title: "Search the screen of the bot's desktop?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          if (
            args.role === undefined &&
            args.name === undefined &&
            args.text === undefined &&
            (args.states ?? []).length === 0
          ) {
            throw new Error("give role, name, text or states")
          }
          const found = await run.attachment.agent.call(
            "find",
            {
              scope: scopeOf(args.scope),
              format: args.format ?? "text",
              ...(args.role === undefined ? {} : { role: args.role }),
              ...(args.name === undefined ? {} : { name: args.name }),
              ...(args.text === undefined ? {} : { text: args.text }),
              ...(args.states === undefined ? {} : { states: args.states }),
              limit: between("limit", args.limit ?? FIND_DEFAULTS.limit, 1, 200),
              visit_budget: FIND_DEFAULTS.visitBudget,
              max_text: TREE_DEFAULTS.maxText,
              geometry: args.geometry ?? false,
            },
            run.signal,
          )
          const head = `snapshot ${found.snapshot}: ${found.matches} matches, ${found.visited} elements visited${found.truncated ? " (stopped early: narrow the scope)" : ""}`
          return typeof found.results === "string"
            ? { text: found.results === "" ? head : `${head}\n${found.results}` }
            : { text: head, data: found.results }
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "act",
        description:
          "Do something to an element through accessibility, without the mouse: press (its default action: buttons, menu items, check boxes, links; action_name picks another), focus, set_text (replace the text of an editable text), set_value (spin buttons, sliders), select (an item of a list or tab list), click (a real mouse click on its centre; button, count), activate (raise a window from desktop_windows), scroll_into_view. " +
          "Answers what changed (opened/closed windows, active window, focus) and the element's state now, waiting up to 2 s for a change. " +
          "When an element cannot do the action the error says what to do instead (Chrome fields: focus, then desktop_key ctrl+a and desktop_type; XFCE panel menus: click; spreadsheet cells: desktop_sheet). In LibreOffice, after working a menu with press, focus the document before typing shortcuts.",
        parameters: {
          element: { type: "string", required: true, description: ELEMENT_DESCRIPTION },
          action: { type: "string", enum: ACT_ACTIONS, required: true },
          text: { type: "string", description: "For set_text." },
          value: { type: "number", description: "For set_value." },
          action_name: { type: "string", description: "For press: one of the element's actions." },
          button: { type: "string", enum: BUTTONS, description: "For click." },
          count: { type: "integer", description: "For click: 1 to 3." },
        },
        kind: "operate",
        preview: (args) => ({
          title: `${args.action} an element on the bot's desktop?`,
          fields: argumentFields(args),
        }),
        async run(args, run) {
          if ((args.action === "set_text") !== (args.text !== undefined)) {
            throw new Error("text goes with set_text, and set_text needs text")
          }
          if ((args.action === "set_value") !== (args.value !== undefined)) {
            throw new Error("value goes with set_value, and set_value needs value")
          }
          const changes = await run.attachment.agent.call(
            "act",
            {
              id: elementId(args.element),
              action: args.action,
              ...(args.text === undefined ? {} : { text: args.text }),
              ...(args.value === undefined ? {} : { value: args.value }),
              ...(args.action_name === undefined ? {} : { action_name: args.action_name }),
              ...(args.button === undefined ? {} : { button: args.button }),
              ...(args.count === undefined ? {} : { count: between("count", args.count, 1, 3) }),
            },
            run.signal,
          )
          return { data: changes }
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "text",
        description:
          "Read the whole text of an element (desktop_tree cuts long texts): offset and limit in characters (limit 1 to 20000, default 4000).",
        parameters: {
          element: { type: "string", required: true, description: ELEMENT_DESCRIPTION },
          offset: { type: "integer" },
          limit: { type: "integer" },
        },
        kind: "observe",
        maxResultChars: TREE_RESULT_CHARS,
        preview: (args) => ({
          title: "Read a text on the bot's desktop?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          const read = await run.attachment.agent.call(
            "text",
            {
              id: elementId(args.element),
              offset: between("offset", args.offset ?? 0, 0, 1e9),
              limit: between("limit", args.limit ?? 4_000, 1, 20_000),
            },
            run.signal,
          )
          const end = read.offset + read.text.length
          return {
            text: read.text,
            data: { length: read.length, offset: read.offset, more: end < read.length },
          }
        },
      },
      deps,
    ),
  ]
}
