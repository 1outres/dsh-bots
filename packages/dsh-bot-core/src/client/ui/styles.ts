export const UI_CSS = `
.dshb-ui-group { display: flex; flex-direction: column; min-width: 0; margin-top: 24px; }
.dshb-ui-group:first-child { margin-top: 0; }
.dshb-ui-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
  margin-bottom: 8px;
  padding: 0 4px;
}
.dshb-ui-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-ui-heading-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshb-ui-group-frame {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-md);
  overflow: hidden;
}
.dshb-ui-group-frame > * + * {
  border-top: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-border-l4);
}
.dshb-ui-page-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  margin-bottom: 16px;
}
.dshb-ui-page-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dshb-ui-row {
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 52px;
  padding: 10px 16px;
  color: var(--dsw-alias-label-primary);
  text-decoration: none;
}
.dshb-ui-row[data-density="compact"] { min-height: 40px; padding-top: 6px; padding-bottom: 6px; }
.dshb-ui-row[data-kind="block"] { flex-direction: column; align-items: stretch; gap: 8px; }
.dshb-ui-row-line { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dshb-ui-row-block { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshb-ui-row-leading { flex: none; display: inline-flex; align-items: center; color: var(--dsw-alias-label-secondary); }
.dshb-ui-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left; }
.dshb-ui-row-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dshb-ui-row-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-ui-row-meta[data-tone="danger"] { color: var(--dsw-alias-state-error-primary); white-space: normal; }
.dshb-ui-row-meta[data-tone="warning"] { color: var(--dsw-alias-state-warn-label); white-space: normal; }
.dshb-ui-button-row {
  width: 100%;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshb-ui-group-frame > * + .dshb-ui-button-row {
  border-top: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-border-l4);
}
.dshb-ui-button-row:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshb-ui-button-row[data-tone="danger"] .dshb-ui-row-label { color: var(--dsw-alias-state-error-primary); }
.dshb-ui-button-row[data-tone="danger"]:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
.dshb-ui-button-row:disabled { opacity: 0.4; cursor: default; }
.dshb-ui-button-row:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshb-ui-row-trailing {
  position: relative;
  z-index: 1;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  max-width: 65%;
  min-width: 0;
}
.dshb-ui-row-trailing:has([aria-expanded="true"]) { z-index: 2; }
.dshb-ui-row-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.dshb-ui-row-open::after { content: ""; position: absolute; inset: 0; }
.dshb-ui-row-open:focus-visible { outline: none; }
.dshb-ui-row-open:focus-visible::after {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
  border-radius: inherit;
}
.dshb-ui-row[data-kind="open"]:hover,
.dshb-ui-row[data-kind="link"]:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshb-ui-row[data-kind="link"]:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshb-ui-row-chevron { flex: none; display: inline-flex; margin-right: -4px; color: var(--dsw-alias-label-tertiary); }
.dshb-ui-row[data-expanded] .dshb-ui-row-chevron { transform: rotate(90deg); }
.dshb-ui-add-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 44px;
  margin-top: 8px;
  padding: 0 16px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshb-ui-group-frame > .dshb-ui-add-row { margin-top: 0; border: none; border-radius: 0; }
.dshb-ui-add-row:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshb-ui-add-row:disabled { opacity: 0.4; cursor: default; }
.dshb-ui-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  margin: 0 0 8px -8px;
  padding: 0 8px 0 4px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshb-ui-back:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.dshb-ui-button {
  box-sizing: border-box;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dshb-ui-button[data-variant="primary"] {
  min-width: 72px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dshb-ui-button[data-variant="primary"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dshb-ui-button[data-variant="primary"][data-tone="danger"] {
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.dshb-ui-button[data-variant="primary"][data-tone="danger"]:hover:not(:disabled) { opacity: 0.88; }
.dshb-ui-button[data-variant="secondary"],
.dshb-ui-button[data-variant="row"] {
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px) var(--dsw-alias-border-l3);
}
.dshb-ui-button[data-variant="secondary"] { min-width: 72px; }
.dshb-ui-button[data-variant="secondary"]:hover:not(:disabled),
.dshb-ui-button[data-variant="row"]:hover:not(:disabled),
.dshb-ui-button[data-variant="icon"]:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshb-ui-button[data-variant="row"] {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm);
  font-size: 12px;
  line-height: 18px;
}
.dshb-ui-button[data-variant="icon"] {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-secondary);
}
.dshb-ui-button[data-tone="danger"]:not([data-variant="primary"]) { color: var(--dsw-alias-state-error-primary); }
.dshb-ui-button[data-tone="danger"]:not([data-variant="primary"]):hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
.dshb-ui-button:disabled { opacity: 0.4; cursor: default; }
.dshb-ui-button:focus-visible,
.dshb-ui-switch:focus-visible,
.dshb-ui-select:focus-visible,
.dshb-ui-back:focus-visible,
.dshb-ui-add-row:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}

.dshb-ui-switch {
  box-sizing: border-box;
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
}
.dshb-ui-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.dshb-ui-switch:disabled { cursor: default; opacity: 0.5; }
.dshb-ui-switch-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-switch-thumb);
  transition: transform 0.12s ease;
}
.dshb-ui-switch[aria-checked="true"] .dshb-ui-switch-thumb {
  background: var(--dsw-alias-label-primary-foreground);
  transform: translateX(16px);
}

.dshb-ui-segmented {
  flex: none;
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 3px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshb-ui-segment {
  box-sizing: border-box;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-sm);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshb-ui-segment-input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: inherit; }
.dshb-ui-segment:hover { color: var(--dsw-alias-label-primary); }
.dshb-ui-segment[data-checked] {
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft);
  color: var(--dsw-alias-label-primary);
}
.dshb-ui-segment:has(.dshb-ui-segment-input:focus-visible) {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -1px;
}
.dshb-ui-segmented:disabled .dshb-ui-segment,
.dshb-ui-segment[data-disabled] { cursor: default; opacity: 0.4; }

.dshb-ui-select {
  box-sizing: border-box;
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 160px;
  max-width: 100%;
  height: 32px;
  padding: 0;
  border: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dshb-ui-select:focus-within { border-color: var(--dsw-alias-state-business-primary); }
.dshb-ui-select[data-disabled], .dshb-ui-select:disabled { opacity: 0.4; }
.dshb-ui-select-input {
  appearance: none;
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 30px 0 10px;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.dshb-ui-select-input option { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshb-ui-select-chevron {
  position: absolute;
  right: 10px;
  display: inline-flex;
  pointer-events: none;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-ui-search-select { display: inline-flex; max-width: 100%; }
button.dshb-ui-select { padding: 0 30px 0 10px; cursor: pointer; text-align: left; }
button.dshb-ui-select:disabled { cursor: default; }
.dshb-ui-select-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshb-ui-popover {
  box-sizing: border-box;
  position: fixed;
  z-index: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
}
.dshb-ui-popover-search {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px;
  border-bottom: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-tertiary);
}
.dshb-ui-popover-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dshb-ui-popover-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dshb-ui-popover-list { flex: 1; min-height: 0; padding: 4px; overflow-y: auto; }
.dshb-ui-popover-option {
  padding: 5px 8px;
  border-radius: var(--dsw-radius-sm);
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dshb-ui-popover-option[data-active] { background: var(--dsw-alias-interactive-bg-hover); }
.dshb-ui-popover-option[aria-selected="true"] { font-weight: 500; }
.dshb-ui-popover-option[aria-disabled="true"] { opacity: 0.4; cursor: default; }
.dshb-ui-popover-group {
  padding: 8px 8px 2px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-ui-menu { padding: 4px; overflow-y: auto; }
.dshb-ui-picker { display: inline-flex; max-width: 100%; }
button.dshb-ui-picker-trigger { height: auto; min-height: 32px; padding-top: 3px; padding-bottom: 3px; }
.dshb-ui-picker-picked { display: flex; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.dshb-ui-picker-placeholder { color: var(--dsw-alias-label-dimmed); }
.dshb-ui-picker-chip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dshb-ui-picker-option { display: flex; align-items: center; gap: 8px; }
.dshb-ui-picker-option[aria-selected="true"] { font-weight: 500; }
.dshb-ui-picker-image {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--dsw-alias-border-l4);
}
.dshb-ui-picker-text { display: flex; flex-direction: column; min-width: 0; }
.dshb-ui-picker-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshb-ui-picker-detail { font-size: 12px; line-height: 16px; font-weight: 400; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshb-ui-menu-item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 32px;
  padding: 5px 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  text-align: left;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dshb-ui-menu-item:hover:not(:disabled), .dshb-ui-menu-item:focus-visible {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshb-ui-menu-item[data-tone="danger"] { color: var(--dsw-alias-state-error-primary); }
.dshb-ui-menu-item:disabled { opacity: 0.4; cursor: default; }
.dshb-ui-popover-none { margin: 0; padding: 8px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

.dshb-ui-field {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 240px;
  max-width: 100%;
  height: 32px;
  padding: 0 10px;
  border: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.dshb-ui-field[data-width="fill"] { width: 100%; }
.dshb-ui-field[data-width="compact"] { width: 88px; }
.dshb-ui-field:focus-within { border-color: var(--dsw-alias-state-business-primary); }
.dshb-ui-field[data-invalid] { border-color: var(--dsw-alias-state-error-primary); }
.dshb-ui-field[data-disabled] { opacity: 0.4; }
.dshb-ui-field-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dshb-ui-field-input::placeholder { color: var(--dsw-alias-label-dimmed); }
@media (pointer: coarse) {
  .dshb-ui-field-input, .dshb-ui-popover-input { font-size: 16px; }
}
.dshb-ui-field-counter {
  flex: none;
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-ui-field-counter[data-full] { color: var(--dsw-alias-state-error-primary); }
.dshb-ui-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 64px;
  padding: 6px 10px;
  resize: vertical;
  border: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.dshb-ui-textarea::placeholder { color: var(--dsw-alias-label-dimmed); }
.dshb-ui-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }
.dshb-ui-textarea[data-invalid] { border-color: var(--dsw-alias-state-error-primary); }
.dshb-ui-textarea[data-flag="warning"] { border-color: var(--dsw-alias-state-warn-primary); }
.dshb-ui-textarea:disabled { opacity: 0.4; }
.dshb-ui-secret-editor { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }

.dshb-ui-pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.dshb-ui-pill-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dshb-ui-pill[data-tone="success"] .dshb-ui-pill-dot { background: var(--dsw-alias-state-success-primary); }
.dshb-ui-pill[data-tone="warning"] { color: var(--dsw-alias-state-warn-label); }
.dshb-ui-pill[data-tone="warning"] .dshb-ui-pill-dot { background: var(--dsw-alias-state-warn-primary); }
.dshb-ui-pill[data-tone="danger"] { color: var(--dsw-alias-state-error-primary); }
.dshb-ui-pill[data-tone="danger"] .dshb-ui-pill-dot { background: var(--dsw-alias-state-error-primary); }
.dshb-ui-pill[data-tone="busy"] .dshb-ui-pill-dot {
  box-sizing: border-box;
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--dsw-alias-state-business-primary);
  border-right-color: transparent;
  background: transparent;
  animation: dshb-ui-spin 0.9s linear infinite;
}
@keyframes dshb-ui-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .dshb-ui-row[data-density="compact"] .dshb-ui-row-label,
  .dshb-ui-row[data-density="compact"] .dshb-ui-row-meta { white-space: normal; overflow-wrap: anywhere; }
  .dshb-ui-segment { padding: 0 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .dshb-ui-pill[data-tone="busy"] .dshb-ui-pill-dot { animation: none; border-right-color: var(--dsw-alias-state-business-primary); }
  .dshb-ui-switch-thumb { transition: none; }
}

.dshb-ui-tag {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.dshb-ui-code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-markdown-inline-code);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
  user-select: all;
}
@media (max-width: 640px) {
  .dshb-ui-code { white-space: normal; overflow-wrap: anywhere; }
}

.dshb-ui-empty {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 240px;
  padding: 32px;
  text-align: center;
}
.dshb-ui-empty-icon { display: inline-flex; color: var(--dsw-alias-label-tertiary); }
.dshb-ui-empty-title { margin: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary); }
.dshb-ui-empty-detail {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  max-width: 100%;
  margin-top: -8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
.dshb-ui-error { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-state-error-primary); }
.dshb-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`
