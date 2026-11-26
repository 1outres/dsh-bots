import { contentPathOf } from "../../shared/spaces"
import { escapeHtml, type WrapperTexts } from "./texts"

export const WRAPPER_SCRIPT = [
  "(() => {",
  '  const frame = document.getElementById("space");',
  '  const gone = document.getElementById("gone");',
  '  const live = new EventSource("_wrap/live");',
  '  live.addEventListener("revision", () => {',
  '    if (frame.isConnected) frame.src = frame.getAttribute("src");',
  "  });",
  '  live.addEventListener("gone", () => {',
  "    live.close();",
  "    frame.remove();",
  "    gone.hidden = false;",
  "  });",
  "})();",
].join("\n")

const STYLE = [
  "html,body{margin:0;height:100%;}",
  "body{display:flex;flex-direction:column;font:14px/1.4 system-ui,sans-serif;background:#fff;color:#1f2328;}",
  "header{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fff4ce;border-bottom:1px solid #d4a72c;flex:none;}",
  "header img{width:28px;height:28px;border-radius:50%;flex:none;}",
  "header strong{display:block;}",
  "iframe{flex:1;border:0;width:100%;}",
  "#gone{margin:24px;}",
].join("")

export interface WrapperPage {
  readonly token: string
  readonly botName: string
  readonly title: string
  readonly avatarDataUrl: string
  readonly texts: WrapperTexts
}

export function wrapperHtml(page: WrapperPage): string {
  return [
    "<!doctype html>",
    `<html lang="${page.texts.lang}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(page.title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    "<header>",
    `<img alt="" src="${escapeHtml(page.avatarDataUrl)}">`,
    `<div><strong>${escapeHtml(page.title)}</strong>${escapeHtml(page.texts.banner(page.botName))}</div>`,
    "</header>",
    `<iframe id="space" title="${escapeHtml(page.title)}" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" src="${contentPathOf(page.token)}"></iframe>`,
    `<p id="gone" hidden>${escapeHtml(page.texts.gone)}</p>`,
    `<script>${WRAPPER_SCRIPT}</script>`,
    "</body>",
    "</html>",
  ].join("\n")
}
