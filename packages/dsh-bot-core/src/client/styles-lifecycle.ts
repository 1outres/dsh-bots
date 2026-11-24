import { NOTICE_FADE_MS, NOTICE_MS } from "./notices"

/** Bots being created or removed: their sidebar rows, the creation progress view and the notices. */
export const LIFECYCLE_CSS = `
.dshb-pending-row { color: var(--dsw-alias-label-secondary); }
.dshb-pending-row[data-inert] { cursor: default; }
.dshb-pending-row[data-failed] { color: var(--dsw-alias-state-error-primary); }
.dshb-pending-face { position: relative; cursor: inherit; }
.dshb-pending-avatar { display: inline-flex; opacity: 0.45; }
.dshb-pending-badge {
  position: absolute;
  right: -3px;
  bottom: 0;
  display: inline-flex;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-state-business-primary);
}
.dshb-pending-row[data-failed] .dshb-pending-badge { color: var(--dsw-alias-state-error-primary); }
.dshb-pending-label {
  flex: none;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-pending-row[data-failed] .dshb-pending-label { color: var(--dsw-alias-state-error-primary); }
.dshb-pending-failure {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 4px 8px calc(var(--dsh-sidebar-row-padding, 12px) + 16px + var(--dsh-sidebar-label-gap, 6px));
  font-size: 12px;
  line-height: 18px;
}
.dshb-pending-actions { display: flex; align-items: center; gap: 6px; }
.dshb-pending-actions [data-dshb-pending-action="details"] { margin-left: auto; }
.dshb-pending-actions [data-dshb-pending-action="details"] svg { transition: transform 150ms var(--ds-ease-in-out, ease); }
.dshb-pending-actions [data-dshb-pending-action="details"][aria-expanded="true"] svg { transform: rotate(180deg); }
.dshb-pending-message {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: var(--dsw-alias-state-error-primary);
}
.dshb-spinner { animation: dshb-spin 900ms linear infinite; }
@keyframes dshb-spin { to { transform: rotate(360deg); } }

.dshb-progress {
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 32px 24px;
  box-sizing: border-box;
}
.dshb-progress-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(420px, 100%);
}
.dshb-progress-face { display: inline-flex; opacity: 0.6; }
.dshb-progress[data-failed] .dshb-progress-face { opacity: 1; }
.dshb-progress-title {
  margin: 4px 0 0;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  text-align: center;
  overflow-wrap: anywhere;
}
.dshb-progress-elapsed {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dshb-steps {
  list-style: none;
  margin: 12px 0 4px;
  padding: 0;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dshb-step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--dsw-radius-md);
  font-size: 14px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-step[data-state='done'] { color: var(--dsw-alias-label-secondary); }
.dshb-step[data-state='current'] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshb-step[data-state='failed'] {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshb-step-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.dshb-step[data-state='done'] .dshb-step-mark { color: var(--dsw-alias-state-success-primary); }
.dshb-step[data-state='current'] .dshb-step-mark { color: var(--dsw-alias-state-business-primary); }
.dshb-step-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-border-l3);
}
.dshb-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.dshb-progress-failure {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dshb-progress-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
  line-height: 19px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.dshb-progress-actions { display: flex; justify-content: flex-end; gap: 8px; }

.dshb-toast {
  position: fixed;
  top: calc(var(--dsh-frame-chrome-top, 0px) + 40px);
  left: 50%;
  z-index: 1100;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 10px;
  width: max-content;
  max-width: min(640px, calc(100vw - 48px));
  box-sizing: border-box;
  padding: 12px 16px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-toast-bg);
  color: var(--dsw-alias-toast-label);
  font-size: 14px;
  line-height: 22px;
  box-shadow: var(--dsw-shadow-lv3);
  transform: translateX(-50%);
  animation:
    dshb-toast-in 160ms ease-out,
    dshb-toast-out ${NOTICE_FADE_MS}ms ease ${NOTICE_MS - NOTICE_FADE_MS}ms forwards;
}
.dshb-toast-icon { flex: none; display: grid; place-items: center; color: var(--dsw-alias-state-warn-label); }
.dshb-toast[data-tone="success"] .dshb-toast-icon { color: var(--dsw-alias-state-success-primary); }
.dshb-toast[data-tone="error"] .dshb-toast-icon { color: var(--dsw-alias-state-error-primary); }
.dshb-toast-text { min-width: 0; overflow-wrap: anywhere; }
.dshb-toast-action {
  display: inline;
  margin-inline: 3px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--dsw-alias-toast-action);
  font: inherit;
  cursor: pointer;
  pointer-events: auto;
}
.dshb-toast-action:first-of-type { margin-inline-start: 8px; }
@media (hover: hover) {
  .dshb-toast-action:hover { opacity: 0.8; }
}
.dshb-toast-action:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
  border-radius: var(--dsw-radius-xs);
}
@keyframes dshb-toast-in { from { opacity: 0; transform: translate(-50%, -6px); } }
@keyframes dshb-toast-out { to { opacity: 0; visibility: hidden; } }
@media (prefers-reduced-motion: reduce) {
  .dshb-toast { animation: dshb-toast-out ${NOTICE_FADE_MS}ms ease ${NOTICE_MS - NOTICE_FADE_MS}ms forwards; }
}
@media (prefers-reduced-motion: reduce) {
  .dshb-spinner { animation-duration: 2400ms; }
}
`
