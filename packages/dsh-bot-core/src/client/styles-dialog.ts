export const DIALOG_CSS = `
.dshb-modal-root {
  pointer-events: auto;
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px;
}
.dshb-modal-mask {
  position: absolute;
  inset: var(--dsh-frame-chrome-top, 0px) 0 0;
  backdrop-filter: var(--dsw-mask-blur);
}
.dshb-modal-mask::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  animation: dshb-enter var(--ds-transition-duration, 150ms) var(--ds-ease-in-out, ease);
}
.dshb-modal {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: min(380px, 100%);
  padding: 0 0 24px;
  overflow: hidden;
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  animation: dshb-enter var(--ds-transition-duration, 150ms) var(--ds-ease-in-out, ease);
}
@keyframes dshb-enter { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .dshb-modal, .dshb-modal-mask::after { animation: none; }
}
.dshb-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 22px 14px 0 24px;
}
.dshb-modal-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dshb-modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 0 24px;
}
.dshb-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px;
}
.dshb-create-identity { display: flex; align-items: center; gap: 12px; }
.dshb-create-identity > .dshb-avatar { flex: none; }
.dshb-avatar-picker {
  display: grid;
  grid-template-columns: repeat(10, 28px);
  gap: 4px;
  justify-content: start;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}
.dshb-avatar-line, .dshb-avatar-radios { display: contents; }
.dshb-avatar-line + .dshb-avatar-line > .dshb-avatar-radios > :first-child { grid-column-start: 1; }
.dshb-avatar-note { grid-column: 1 / -1; }
@media (max-width: 640px) {
  .dshb-avatar-picker { grid-template-columns: repeat(10, 26px); gap: 2px; }
  .dshb-avatar-choice { width: 26px; height: 26px; }
}
.dshb-avatar-choice {
  box-sizing: border-box;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
@media (hover: hover) {
  .dshb-avatar-choice:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshb-avatar-choice[aria-checked="true"],
.dshb-avatar-choice[aria-pressed="true"] {
  box-shadow: inset 0 0 0 1.5px var(--dsw-alias-state-business-primary);
}
.dshb-avatar-choice:disabled { cursor: default; opacity: 0.4; }
.dshb-avatar-choice:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dshb-avatar-swatch { display: block; width: 18px; height: 18px; border-radius: 50%; }
.dshb-avatar-note {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
.dshb-avatar-note[data-tone="danger"] { color: var(--dsw-alias-state-error-primary); }
.dshb-modal.dshb-create { width: min(440px, 100%); }
.dshb-create .dshb-modal-body { gap: 20px; }
.dshb-create .dshb-modal-body > .dshb-ui-group { margin-top: 0; }
.dshb-create-vm-spec { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
`
