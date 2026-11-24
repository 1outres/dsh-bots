/** The bot file viewer's content, in the shell's side panel frame (styles-shell.ts); the frame's resize handle. */
export const FILES_CSS = `
.dshb-files-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  z-index: 2;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}
.dshb-files-resize:hover,
.dshb-files-resize:focus-visible {
  outline: none;
  background: linear-gradient(to right, transparent 3px, var(--dsw-alias-scrollbar-bg-l1) 3px, var(--dsw-alias-scrollbar-bg-l1) 5px, transparent 5px);
}
.dshb-files-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 8px 8px 12px;
}
.dshb-files-search { padding: 0 6px 6px; }
.dshb-files-input {
  width: 100%;
  box-sizing: border-box;
  height: 30px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.dshb-files-input:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -1px;
}
.dshb-files-count { margin: 0 6px 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshb-files-count:empty { display: none; }
.dshb-files-tree { flex: 1 1 auto; min-height: 0; }
.dshb-files-dim,
.dshb-files-note {
  display: block;
  margin: 8px 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-files-preview { display: flex; flex-direction: column; min-width: 0; }
.dshb-files-path {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 6px 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
.dshb-files-path > span { flex: 1 1 auto; min-width: 0; }
.dshb-files-code {
  margin: 0;
  padding: 6px 0;
  overflow: auto;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-markdown-code-block);
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 18px;
}
.dshb-files-code:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dshb-files-source { padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dshb-files-line { display: flex; min-width: max-content; padding-inline-end: 12px; }
/* DSH's navigated-line mark (ui-sidebar-documentpreview TextPreview .lineMark), kept while the line is current. */
.dshb-files-line[data-current] { background: var(--dsw-alias-interactive-bg-hover-accent); }
.dshb-files-number {
  flex: none;
  width: 4ch;
  padding: 0 10px 0 6px;
  color: var(--dsw-alias-label-tertiary);
  text-align: right;
  user-select: none;
}
.dshb-files-line > code { white-space: pre; font: inherit; }
.dshb-files-more { align-self: flex-start; margin: 6px; }
.dshb-files-image { display: flex; justify-content: center; padding: 8px; }
.dshb-files-image > img { max-width: 100%; height: auto; }
.dshb-files-markdown { padding: 0 6px; font-size: 14px; line-height: 22px; overflow-wrap: anywhere; }
.dshb-files-markdown pre {
  padding: 8px 10px;
  overflow: auto;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-markdown-code-block);
  font-size: 12px;
  line-height: 18px;
}
.dshb-files-markdown code { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 0.9em; }
.dshb-files-markdown blockquote {
  margin: 8px 0;
  padding-inline-start: 12px;
  border-inline-start: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dshb-files-markdown a { color: var(--dsw-alias-state-business-primary); }
.dshb-files-markdown hr { border: none; border-top: 0.5px solid var(--dsw-alias-border-l3); }

`
