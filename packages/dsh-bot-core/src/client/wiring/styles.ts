import { PICKER_CSS, watchWorkspacePickers } from "../hide-picker-workspaces"
import { botSessionsCss } from "../hide-sessions"
import { derive, type Observable } from "../observable"
import { type BotsState, snapshotOf } from "../session-classification"
import { BOTS_CSS } from "../styles"
import { hiddenPresetsCss } from "../styles-presets"
import type { ClientContext, SessionListState, WorkspaceSnapshot } from "../types"
import { PLUGIN_ID } from "./plugin"

function hidingCss(
  state: BotsState,
  list: SessionListState,
  workspaces: WorkspaceSnapshot,
): string {
  const snapshot = snapshotOf(state)
  if (snapshot === undefined) return ""
  return [botSessionsCss(state, { list, workspaces }), hiddenPresetsCss(snapshot.bots)]
    .filter((part) => part !== "")
    .join("\n")
}

function styleSheet(name: string, css: Observable<string>): () => void {
  const tag = document.createElement("style")
  tag.dataset.plugin = name
  const sync = () => {
    const text = css.getSnapshot()
    if (tag.textContent !== text) tag.textContent = text
  }
  sync()
  document.head.append(tag)
  const off = css.subscribe(sync)
  return () => {
    off()
    tag.remove()
  }
}

const constant = (text: string): Observable<string> => ({
  getSnapshot: () => text,
  subscribe: () => () => {},
})

export function wireStyles(ctx: ClientContext, bots: Observable<BotsState>): void {
  ctx.effect(() => styleSheet(PLUGIN_ID, constant(BOTS_CSS)), "bot-core: stylesheet")
  ctx.effect(
    () =>
      styleSheet(
        `${PLUGIN_ID}/hidden-sessions`,
        derive([bots, ctx.sessions.list, ctx.workspaces.list], hidingCss),
      ),
    "bot-core: hide bot sessions and presets from the stock lists",
  )
  ctx.effect(() => {
    const dispose = styleSheet(`${PLUGIN_ID}/picker`, constant(PICKER_CSS))
    const watch = watchWorkspacePickers()
    return () => {
      watch.dispose()
      dispose()
    }
  }, "bot-core: hide bot presets from the preset menu")
}
