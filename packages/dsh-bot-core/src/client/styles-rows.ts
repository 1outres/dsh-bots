export const ROWS_CSS = `
.dshb-stack {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dshb-newrow {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dshb-portal {
  flex: none;
  min-width: 0;
}
.dshb-section {
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin-bottom: 12px;
}
.dshb-header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding-left: var(--dsh-sidebar-row-padding, 12px);
  /* Same right edge as the Workspaces header's 28px icon buttons. */
  padding-right: 1px;
  margin-right: -4px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-header-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
}
.dshb-icon-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshb-icon-button:disabled { opacity: 0.4; cursor: default; }
.dshb-icon-button[data-dshb-global-settings-attention] { position: relative; }
.dshb-icon-button[data-dshb-global-settings-attention]::after {
  content: "";
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
}
.dshb-icon-button[data-dshb-global-settings-attention="danger"]::after { background: var(--dsw-alias-state-error-primary); }
@media (hover: hover) {
  .dshb-icon-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
/* In the sidebar's viewport the section keeps its natural height: it scrolls
   away with the panel list before Workspaces scrolls its own rows, and Show
   more keeps it short. Only the fallback under New Session, outside that
   viewport, bounds it. */
.dshb-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dshb-stack .dshb-list {
  max-height: max(96px, calc(100dvh / 3 - 44px));
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dshb-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dshb-detail {
  display: block;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-caption);
}
.dshb-note {
  padding: 6px var(--dsh-sidebar-row-padding, 12px);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-row {
  display: flex;
  align-items: center;
  gap: var(--dsh-sidebar-label-gap, 6px);
  height: 32px;
  flex: none;
  box-sizing: border-box;
  padding: 0 8px;
  padding-inline-start: calc(var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px));
  border: none;
  border-radius: var(--dsw-radius-md);
  border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent;
  background-clip: padding-box;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
}
.dshb-icon-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshb-row[data-selected],
.dshb-row[data-menu-open] { background-color: var(--dsw-alias-interactive-bg-hover); }
@media (hover: hover) {
  .dshb-row:hover { background-color: var(--dsw-alias-interactive-bg-hover); }
}
.dshb-row:focus { outline: none; }
/* Keyboard focus rings the whole row, inside its rounded corners. */
.dshb-row:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshb-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
}
/* Leading 16px cell, as in Workspaces project rows: the avatar at rest, the
   expand arrow only while the pointer hovers the row. Keyboard focus keeps the
   avatar in view; keyboard users expand with → / ← on the row. */
.dshb-slot {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
  color: var(--dsw-alias-label-caption);
  cursor: pointer;
}
.dshb-toggle-avatar,
.dshb-toggle-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dshb-toggle-chevron { display: none; }
.dshb-toggle-chevron svg { transition: transform 150ms var(--ds-ease-in-out, ease); }
.dshb-toggle[data-open] .dshb-toggle-chevron svg { transform: rotate(90deg); }
@media (hover: hover) {
  .dshb-bot-row:hover .dshb-toggle-chevron { display: inline-flex; }
  .dshb-bot-row:hover .dshb-toggle-avatar { display: none; }
}
.dshb-avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  object-fit: cover;
  line-height: 1;
  overflow: hidden;
}
.dshb-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
}
/* Trailing hover actions, copied from Workspaces rows: 24px targets on
   compact glyphs, with compensating margins and a shared 13px gap. */
.dshb-row-actions {
  display: none;
  flex: none;
  align-items: center;
  gap: 13px;
  height: 20px;
}
@media (hover: hover) {
  .dshb-row:hover .dshb-row-actions { display: inline-flex; }
}
.dshb-row:focus-visible .dshb-row-actions,
.dshb-row[data-menu-open] .dshb-row-actions { display: inline-flex; }
@media (hover: none) { .dshb-row-actions { display: inline-flex; } }
.dshb-row-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: -4px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-xs);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshb-row-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
@media (hover: hover) {
  .dshb-row-button:hover { color: var(--dsw-alias-label-primary); }
}
.dshb-children {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dshb-main-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: var(--dsw-alias-label-caption);
}
/* A session the bot's Main session manages: a quiet glyph after its title. */
.dshb-managed-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-caption);
}
/* Archived rows are grayed in place, as in Workspaces' "show archived". */
.dshb-session-row[data-archived] .dshb-title { color: var(--dsw-alias-label-caption); }
/* Workspaces' "Show N more sessions" row, aligned with the session titles. */
.dshb-overflow {
  flex: none;
  display: flex;
  align-items: center;
  height: 28px;
  box-sizing: border-box;
  padding: 0 var(--dsh-sidebar-row-padding, 12px) 0 calc(var(--dsh-sidebar-row-padding, 12px) + 16px + var(--dsh-sidebar-label-gap, 6px));
  border-radius: var(--dsw-radius-sm);
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  user-select: none;
}
@media (hover: hover) {
  .dshb-overflow:hover { color: var(--dsw-alias-label-secondary); }
}
.dshb-overflow:focus { outline: none; }
.dshb-overflow:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshb-row-error {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 0 4px 4px calc(var(--dsh-sidebar-row-padding, 12px) + 16px + var(--dsh-sidebar-label-gap, 6px));
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}
.dshb-row-error-text { flex: 1; min-width: 0; padding-top: 5px; overflow-wrap: anywhere; }
.dshb-row-error .dshb-ui-button[data-variant="icon"] { width: 24px; height: 24px; }
@media (prefers-reduced-motion: reduce) {
  .dshb-toggle-chevron svg { transition: none; }
}
`
