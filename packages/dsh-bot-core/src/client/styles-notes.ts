/** The notes panel's content, in the shell's side panel frame (styles-shell.ts); the note body reuses the file viewer's Markdown look. */
export const NOTES_CSS = `
.dshb-notes-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px 16px;
}
.dshb-notes-body > .dshb-ui-segmented { align-self: flex-start; }
.dshb-notes-body .dshb-ui-group { margin: 0; }
.dshb-notes-toolbar { display: flex; gap: 8px; align-items: center; }
.dshb-notes-toolbar > .dshb-ui-field { flex: 1 1 auto; min-width: 0; }
.dshb-notes-toolbar > .dshb-ui-select { flex: none; }
.dshb-notes-usage { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshb-notes-summary-line,
.dshb-notes-hit {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshb-notes-hit { color: var(--dsw-alias-label-secondary); }
.dshb-notes-hit::before { content: "“"; }
.dshb-notes-hit::after { content: "”"; }
.dshb-notes-note { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dshb-notes-head { display: flex; flex-direction: column; gap: 4px; }
.dshb-notes-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.dshb-notes-aliases { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshb-notes-summary { margin: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary); }
.dshb-notes-text { padding: 0; }
.dshb-notes-text > :first-child { margin-top: 0; }
.dshb-notes-link {
  display: inline;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--dsw-alias-state-business-primary);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  cursor: pointer;
}
span.dshb-notes-link { cursor: inherit; text-decoration: none; }
.dshb-notes-link[data-missing] {
  color: var(--dsw-alias-state-error-primary);
  text-decoration: line-through;
  cursor: default;
}
.dshb-notes-link:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
  border-radius: 2px;
}
.dshb-notes-calendar { display: flex; flex-direction: column; gap: 8px; }
.dshb-notes-calendar-head { display: flex; align-items: center; gap: 4px; }
.dshb-notes-month { flex: 1 1 auto; margin: 0; text-align: center; font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dshb-notes-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
.dshb-notes-grid th {
  padding: 4px 0;
  font-size: 12px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-notes-grid td { padding: 2px; text-align: center; }
.dshb-notes-day {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-notes-day[data-today] { box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
button.dshb-notes-day { color: var(--dsw-alias-label-primary); font-weight: 500; cursor: pointer; }
button.dshb-notes-day::after {
  content: "";
  position: absolute;
  bottom: 4px;
  left: 50%;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
}
button.dshb-notes-day:hover { background: var(--dsw-alias-interactive-bg-hover-accent); }
button.dshb-notes-day:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
`
