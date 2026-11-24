import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import type { DesktopSession } from "../session"
import {
  MAX_SHEET_WRITE_CELLS,
  parseAddress,
  parseRange,
  planSheetWrite,
  renderSheet,
} from "../sheet"
import { argumentFields, type DesktopToolDeps, desktopTool } from "./define"

const FOCUS_TIMEOUT_MS = 2_000
const STEP_SETTLE_MS = 40

export function sheetTools(deps: DesktopToolDeps): BotConnectorToolDefinition<DesktopSession>[] {
  return [
    desktopTool(
      {
        name: "sheet",
        description:
          'LibreOffice Calc\'s sheet in the active window. read: its non-empty cells, one line per row (A1="Price" C1="120"), for range (like A1:F30, at most 2000 cells) or what is visible; texts are the cells\' values as shown before formatting (a formula\'s result, not the formula). ' +
          `write: values, rows of cells (string, number, boolean; "" clears a cell, null leaves it), with its top-left cell at start; strings starting with = are formulas. At most ${MAX_SHEET_WRITE_CELLS} cells per call, one line each (no tabs or line breaks). Answers the written block read back. ` +
          "Do not select cells with desktop_act select. For exact data work (formats, many rows) edit the file itself instead.",
        parameters: {
          action: { type: "string", enum: ["read", "write"], required: true },
          range: {
            type: "string",
            description: "For read: like A1:F30; the visible cells when absent.",
          },
          start: { type: "string", description: "For write: the top-left cell, like B2." },
          values: {
            type: "array",
            description: "For write: rows of cell values.",
            items: {
              type: "array",
              items: {
                oneOf: [
                  { type: "string" },
                  { type: "number" },
                  { type: "boolean" },
                  { type: "null" },
                ],
              },
            },
          },
        },
        kind: (args) => (args.action === "write" ? "operate" : "observe"),
        maxResultChars: 64_000,
        preview: (args) => ({
          title:
            args.action === "write"
              ? "Write cells in the bot's spreadsheet?"
              : "Read the bot's spreadsheet?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          const { agent } = run.attachment
          if (args.action === "read") {
            if (args.start !== undefined || args.values !== undefined)
              throw new Error("read takes range only")
            if (args.range !== undefined) parseRange(args.range)
            const sheet = await agent.call(
              "sheet_read",
              {
                ...(args.range === undefined ? {} : { range: args.range.trim().toUpperCase() }),
                max_cells: 480,
              },
              run.signal,
            )
            return { text: renderSheet(sheet) }
          }
          if (args.start === undefined || args.values === undefined || args.range !== undefined) {
            throw new Error("write takes start and values")
          }
          parseAddress(args.start)
          const located = await agent.call(
            "sheet_read",
            { range: args.start.trim().toUpperCase(), max_cells: 1 },
            run.signal,
          )
          const plan = planSheetWrite(located.window.id, args.start, args.values, {
            focusTimeoutMs: FOCUS_TIMEOUT_MS,
          })
          await agent.call("sequence", { steps: plan.steps, settle_ms: STEP_SETTLE_MS }, run.signal)
          const written = await agent.call(
            "sheet_read",
            { range: plan.range, max_cells: 480 },
            run.signal,
          )
          return {
            text: [`wrote ${plan.cells} cells in ${plan.range}:`, renderSheet(written)].join("\n"),
          }
        },
      },
      deps,
    ),
  ]
}
