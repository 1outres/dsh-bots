/**
 * The bot session shell (shell/). Up to the width handles, a copy of DSH's
 * ConversationRoot.module.css (upstream.ts) restated on the content Factory's
 * stable data attributes, each inside :where() so DSH's composer-overlay
 * rules still win; then bot-core's own parts.
 */
export const SHELL_CSS = `
.dshb-shell {
  position: relative;
  display: flex;
  flex-direction: row;
  height: 100%;
  min-width: 0;
  background: var(--dsw-alias-bg-base);
}
.dshb-shell[data-phase='hero'] { isolation: isolate; }
.dshb-shell[data-phase='active'] { overflow: hidden; }
.dshb-shell-main {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.dshb-shell[data-phase='active'] :where([data-conversation-scroll] > [data-slot='conversation.session'] > div) {
  flex: 1 0 auto;
  min-height: auto;
}
.dshb-shell[data-phase='active'] :where([data-composer-seat]) {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  z-index: 9;
  will-change: transform;
  overflow-anchor: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
    var(--dsw-alias-bg-base) 36px
  );
}
.dshb-shell[data-phase='hero'] :where([data-conversation-scroll]) {
  justify-content: center;
  overflow-y: auto;
}
.dshb-shell[data-phase='settling'] :where([data-composer-seat]) { visibility: hidden; }

.dshb-width-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 0;
  width: min(
    10px,
    calc((100% - var(--dsh-chat-content-width)) / 2 - 24px - 24px)
  );
  cursor: col-resize;
}
.dshb-width-handle[data-side='left'] { right: calc(50% + var(--dsh-chat-content-width) / 2 + 24px); }
.dshb-width-handle[data-side='right'] { left: calc(50% + var(--dsh-chat-content-width) / 2 + 24px); }
.dshb-width-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(
    to bottom,
    transparent calc(var(--dsh-width-handle-pointer-y, 50%) - 36px),
    var(--dsw-alias-scrollbar-bg-l1) calc(var(--dsh-width-handle-pointer-y, 50%) - 8px),
    var(--dsw-alias-scrollbar-bg-l1) calc(var(--dsh-width-handle-pointer-y, 50%) + 8px),
    transparent calc(var(--dsh-width-handle-pointer-y, 50%) + 36px)
  );
  opacity: 0;
  pointer-events: none;
}
.dshb-width-handle[data-side='left']::after { right: 4px; }
.dshb-width-handle[data-side='right']::after { left: 4px; }
.dshb-width-handle[data-dragging]::after { opacity: 1; }
@media (hover: hover) {
  .dshb-width-handle:hover::after { opacity: 1; }
}
.dshb-shell:has([data-conversation-composer-overlay]) .dshb-width-handle { display: none; }

.dshb-shell-placeholder {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: 24px;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
}
.dshb-shell-placeholder > p { margin: 0; }

/* DSH's conversation header without tabs (ConversationRoot .header): a 10px inset around the 30px title row, a hairline under it. */
.dshb-shell-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  height: 50px;
  padding: 10px 16px 10px 20px;
  /* Clears the frame's window-chrome controls when published, as DSH's title row. */
  padding-inline-start: max(20px, var(--dsh-frame-leading-clearance, 0px));
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
.dshb-shell-title {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 30px;
  overflow: hidden;
  white-space: nowrap;
}
.dshb-shell-face {
  flex: none;
  display: inline-flex;
  width: 24px;
  height: 24px;
  border-radius: 50%;
}
.dshb-shell-face[data-pending] { background: var(--dsw-alias-interactive-bg-hover); }
.dshb-shell-name {
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
}
.dshb-shell-name[data-pending] { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.dshb-shell-name:focus { outline: none; }
.dshb-shell-sep { flex: none; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-caption); }
.dshb-shell-session {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
}
.dshb-shell-button {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshb-shell-button:disabled,
.dshb-shell-button[aria-disabled='true'] { opacity: 0.4; cursor: default; }
.dshb-shell-button[aria-expanded='true'],
.dshb-shell-button[aria-pressed='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
@media (hover: hover) {
  .dshb-shell-button:hover:not(:disabled):not([aria-disabled='true']) {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dshb-shell-button:focus { outline: none; }
.dshb-shell-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshb-shell-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
  box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-base);
}
.dshb-shell-count {
  position: absolute;
  top: -2px;
  right: -4px;
  box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-base);
}

/* The first button's centre sits on the header's centre line (25px). */
.dshb-shell-bar {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 52px;
  padding: 9px 0 14px;
  border-left: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-base);
}
.dshb-shell-bar .dshb-shell-button { width: 32px; height: 32px; }

.dshb-shell-menu { position: relative; flex: none; display: inline-flex; }
.dshb-shell-menu-scrim { position: fixed; inset: 0; z-index: 39; }
.dshb-shell-menu-list {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  padding: 4px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
}
.dshb-shell-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
}
.dshb-shell-menu-item:hover,
.dshb-shell-menu-item:focus-visible { outline: none; background: var(--dsw-alias-interactive-bg-hover); }
.dshb-shell-menu-item[aria-checked='true'] { font-weight: 500; }
.dshb-shell-menu-item[aria-disabled='true'] { opacity: 0.4; cursor: default; }
.dshb-shell-menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshb-shell-menu-item .dshb-shell-count,
.dshb-shell-menu-item .dshb-shell-dot { position: static; box-shadow: none; }

/* Banners float under the header over the transcript: they never move it. */
.dshb-shell-banners {
  position: absolute;
  top: 50px;
  right: 0;
  left: 0;
  z-index: 12;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 16px 0;
  pointer-events: none;
}
.dshb-shell-banners:empty { display: none; }
.dshb-shell-banner {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: min(720px, 100%);
  min-height: 36px;
  padding: 6px 8px 6px 14px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-input-major);
  box-shadow: var(--dsw-elevation-panel);
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
  pointer-events: auto;
}
.dshb-shell-banner:not(:has(.dshb-shell-banner-close)) { padding-right: 14px; }
.dshb-shell-banner::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary);
}
.dshb-shell-banner[data-tone='warning'] { color: var(--dsw-alias-state-warn-label); }
.dshb-shell-banner[data-tone='warning']::before { background: var(--dsw-alias-state-warn-primary); }
.dshb-shell-banner[data-tone='danger'] { color: var(--dsw-alias-state-error-primary); }
.dshb-shell-banner[data-tone='danger']::before { background: var(--dsw-alias-state-error-primary); }
.dshb-shell-banner-text { flex: 1 1 auto; min-width: 0; }
.dshb-shell-banner-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshb-shell-banner-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshb-shell-banner-close:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 0;
}

/* Side panels (Files, Actions, connectors): beside the chat, over it once it would get narrower than 640px, a sheet on a compact window. */
.dshb-panel {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 70%;
  min-height: 0;
  box-sizing: border-box;
  border-left: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.dshb-panel[data-layout='overlay'] {
  position: absolute;
  top: 0;
  right: 52px;
  bottom: 0;
  z-index: 20;
  max-width: calc(100% - 52px - 48px);
  box-shadow: var(--dsw-elevation-panel);
}
.dshb-panel[data-layout='sheet'] {
  position: absolute;
  inset: 0;
  z-index: 30;
  max-width: none;
  border-left: none;
}
.dshb-panel-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  height: 50px;
  padding: 10px 12px 10px 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
.dshb-panel-header > .dshb-shell-button:first-child { margin-left: -6px; }
.dshb-panel-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  outline: none;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshb-panel-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.dshb-panel-note {
  margin: 12px 16px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

/* Popovers (a connector's screen) in the overlay frame (styles-overlay.ts): as large as their body, within the bounds it is given. */
.dshb-popover-host { display: contents; }
.dshb-popover {
  --dshb-overlay-body-width: calc(100vw - 48px);
  --dshb-overlay-body-height: calc(100dvh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)) - 56px);
  display: flex;
  flex-direction: column;
  min-width: min(480px, 100%);
  max-width: 100%;
  max-height: 100%;
}
.dshb-overlay-root[data-layout="compact"] .dshb-popover {
  --dshb-overlay-body-width: 100vw;
  --dshb-overlay-body-height: calc(100dvh - var(--dsh-frame-chrome-top, 0px) - 56px);
  min-width: 0;
}
.dshb-popover-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.dshb-shell-error {
  margin: auto;
  padding: 24px;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-tertiary);
}
`
