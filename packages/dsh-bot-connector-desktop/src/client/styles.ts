/** The desktop panel's look, in bot-core's row and button measures on DSH's theme tokens; rendered with the panel. */
export const PANEL_CSS = `
.dsdk-panel { flex: 1 1 auto; display: flex; flex-direction: column; gap: 12px; min-height: 0; padding: 12px 16px 16px; }
.dsdk-bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 28px; }
.dsdk-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsdk-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dsdk-dot[data-tone='agent'] { background: var(--dsw-alias-state-success-primary); }
.dsdk-dot[data-tone='self'] { background: var(--dsw-alias-state-warn-primary); }
.dsdk-dot[data-tone='other'] { background: var(--dsw-alias-state-business-primary); }
.dsdk-spacer { flex: 1 1 auto; }
.dsdk-button {
  box-sizing: border-box;
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px) var(--dsw-alias-border-l3);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dsdk-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsdk-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsdk-primary {
  box-shadow: none;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dsdk-primary:hover { background: var(--dsw-alias-button-primary-hover); }
.dsdk-request {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-height: 52px;
  padding: 10px 16px;
  border: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-md);
}
.dsdk-request-text { flex: 1 1 200px; display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.dsdk-request-title { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dsdk-request-reason { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsdk-request-actions { display: inline-flex; gap: 8px; }
.dsdk-warning { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-label); }
.dsdk-screen {
  flex: 1 1 auto;
  min-height: 160px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-markdown-code-block);
  overflow: hidden;
}
.dsdk-screen[data-dsdk-self] { outline: 2px solid var(--dsw-alias-state-warn-primary); outline-offset: -2px; }
`
