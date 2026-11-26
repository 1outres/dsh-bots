export const APPROVALS_CSS = `
.dshb-waiting[data-tone='danger'] { background: var(--dsw-alias-state-error-primary); }
.dshb-waiting {
  flex: none;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  text-align: center;
}
.dshb-actions-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
}
.dshb-actions-body > .dshb-ui-empty { flex: 1 1 auto; }
.dshb-actions-body > * + * { margin-top: 24px; }
.dshb-actions-open { display: flex; flex-direction: column; gap: 12px; }
.dshb-action {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-specific-input-major);
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-primary);
}
.dshb-action-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.dshb-action-expiry {
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-action-title {
  margin: 0;
  font-size: 15px;
  line-height: 24px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.dshb-action-fields {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 12px;
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 20px;
}
.dshb-action-field { display: contents; }
.dshb-action-field dt { color: var(--dsw-alias-label-tertiary); }
.dshb-action-field dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.dshb-action-long { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; margin-top: 8px; }
.dshb-action-text {
  box-sizing: border-box;
  width: 100%;
  max-height: 320px;
  margin: 0;
  padding: 0 0 0 12px;
  overflow-y: auto;
  border-left: 2px solid var(--dsw-alias-border-l3);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dshb-action-text[data-mono] { font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12px; line-height: 18px; }
.dshb-action-meta {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
.dshb-action-error { margin: 4px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.dshb-action-buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.dshb-actions-item { display: flex; flex-direction: column; min-width: 0; }
.dshb-action-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 16px 14px;
}
.dshb-action-details > .dshb-action-long,
.dshb-action-details > .dshb-action-fields { margin-top: 0; }
.dshb-action-section { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshb-action-section > .dshb-action-long { margin-top: 0; }
.dshb-action-caption { margin: 0; font-size: 12px; line-height: 18px; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.dshb-action-outcome { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dshb-action-outcome[data-tone='danger'] { color: var(--dsw-alias-state-error-primary); }
@media (max-width: 640px) {
  .dshb-action-buttons > .dshb-ui-button { flex: 1 1 0; }
}
`
