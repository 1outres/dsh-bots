/**
 * bot-core's question, approval and plan review cards in a bot session's
 * composer seat, in DSH's QuestionComposer measures (ui-user-questions
 * QuestionComposer.module.css): the composer's width axis, no border,
 * radius-xl, the input-major fill and the panel elevation.
 */
export const INTERACTIONS_CSS = `
.dshb-ask-frame {
  display: flex;
  justify-content: center;
  padding: 6px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 10px;
}
.dshb-ask {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--dsh-chat-content-width, 760px);
  max-height: min(60vh, 520px);
  padding: 0 0 10px;
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l2-darkmode-thin);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-specific-input-major);
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  font-size: 14px;
  line-height: 22px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.dshb-ask * { box-sizing: border-box; }
.dshb-ask[data-minimized] { max-height: none; padding-bottom: 14px; }
.dshb-ask-head {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px 16px 0 24px;
}
.dshb-ask-heading { flex: 1; min-width: 0; }
.dshb-ask-eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-ask-title {
  margin: 0;
  font-size: 16px;
  line-height: 22px;
  font-weight: 500;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dshb-ask[data-minimized] .dshb-ask-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.dshb-ask-head-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; margin-left: auto; }
.dshb-ask-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
@media (hover: hover) {
  .dshb-ask-icon:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}
.dshb-ask-icon:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 0;
}
.dshb-ask-wait {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 24px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.dshb-ask-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  margin-top: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dshb-ask-detail { margin: 0 24px; color: var(--dsw-alias-label-secondary); }
.dshb-ask-plan {
  max-height: 320px;
  margin: 0 24px;
  padding: 0 12px;
  overflow-y: auto;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-lg);
}
.dshb-ask-options {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  margin: 0;
  padding: 0 12px;
  border: none;
}
.dshb-ask-option {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px 8px 8px;
  border: 0.5px solid transparent;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
@media (hover: hover) {
  .dshb-ask-option:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshb-ask-option[aria-pressed='true'] {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshb-ask-option:disabled { cursor: default; }
.dshb-ask-option:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshb-ask-mark {
  flex: 0 0 20px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-bg-overlay);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dshb-ask-option[data-multi] .dshb-ask-mark {
  width: 14px;
  height: 14px;
  flex-basis: 14px;
  margin: 5px 3px 0;
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: transparent;
}
.dshb-ask-option[data-multi][aria-pressed='true'] .dshb-ask-mark {
  border-color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.dshb-ask-option-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.dshb-ask-option-label { font-size: 14px; line-height: 24px; font-weight: 500; overflow-wrap: anywhere; }
.dshb-ask-option-description { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dshb-ask-custom {
  flex-shrink: 0;
  width: 100%;
  min-height: 40px;
  max-height: 144px;
  padding: 8px 12px 8px 36px;
  border: 0.5px solid transparent;
  border-radius: var(--dsw-radius-md);
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 24px;
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-state-business-primary);
  resize: none;
  field-sizing: content;
}
.dshb-ask-custom::placeholder { color: var(--dsw-alias-label-caption); }
.dshb-ask-custom:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshb-ask-custom:focus { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); }
.dshb-ask-custom[data-block] {
  width: auto;
  min-height: 64px;
  margin: 0 12px;
  padding: 8px 12px;
  border-color: var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-module-platform);
}
.dshb-ask-options .dshb-ask-custom[data-block] { margin: 0; }
.dshb-ask-custom[data-block]:focus { border-color: var(--dsw-alias-state-business-primary); }
.dshb-ask-note { margin: 0 24px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.dshb-ask-summary { margin: 0 24px; padding-left: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dshb-ask-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 0 10px 0 18px;
}
.dshb-ask-footer-start { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshb-ask-footer-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; margin-left: auto; }
.dshb-ask-pager {
  padding: 0 4px;
  font-size: 14px;
  line-height: 24px;
  font-weight: 500;
  word-spacing: -2px;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.dshb-ask-error {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 11px;
  line-height: 16px;
  text-align: right;
  color: var(--dsw-alias-state-error-primary);
}
.dshb-ask-more { margin: 8px 24px 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
@media (max-width: 720px) {
  .dshb-ask-head { padding: 10px 12px 0 18px; }
  .dshb-ask-options { padding: 0 8px; }
  .dshb-ask-title { font-size: 15px; line-height: 21px; }
  .dshb-ask-option { padding: 8px 6px; }
  .dshb-ask-footer { align-items: flex-end; padding: 0 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .dshb-ask-option { transition: none; }
}
`
