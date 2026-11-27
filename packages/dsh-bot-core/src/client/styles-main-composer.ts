export const MAIN_COMPOSER_CSS = `
.dshb-mc {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 var(--dsh-composer-side-clearance, 16px) 12px;
}
.dshb-mc-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, 760px);
  margin-bottom: 6px;
  padding: 4px 4px 4px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-state-danger);
  font-size: 12px;
  line-height: 18px;
}
.dshb-mc-notice > span {
  flex: 1;
  min-width: 0;
}
.dshb-mc-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshb-mc-card {
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, 760px);
  padding-top: 8px;
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-specific-input-major);
  box-shadow: var(--dsw-elevation-soft);
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.dshb-mc-card[data-dragging]::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px dashed var(--dsw-alias-state-business-primary);
  border-radius: var(--dsw-radius-panel);
  pointer-events: none;
}
@media (pointer: coarse) {
  .dshb-mc-card {
    font-size: max(16px, var(--dsh-content-font-size, 14px));
  }
}
.dshb-mc-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 4px 12px 0;
  list-style: none;
}
.dshb-mc-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 40px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-specific-selector);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dshb-mc-chip[data-kind="image"] {
  width: 56px;
  height: 56px;
  padding: 0;
  overflow: hidden;
}
.dshb-mc-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dshb-mc-chip-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dshb-mc-chip-state {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-mc-chip[data-kind="image"] .dshb-mc-chip-state {
  position: absolute;
  inset: auto 0 0;
  padding: 0 4px;
  background: var(--dsw-alias-interactive-bg-hover-solid);
  text-align: center;
}
.dshb-mc-chip-state[data-tone="danger"] {
  color: var(--dsw-alias-state-danger);
}
.dshb-mc-chip[data-status="failed"] {
  outline: 1px solid var(--dsw-alias-state-danger);
}
.dshb-mc-chip-remove {
  display: grid;
  place-items: center;
  flex: none;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover-solid);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dshb-mc-chip[data-kind="image"] .dshb-mc-chip-remove {
  position: absolute;
  top: 2px;
  right: 2px;
}
.dshb-mc-scroll {
  max-height: var(--dsh-composer-text-max-height, 336px);
  overflow-y: auto;
  margin-right: 4px;
}
.dshb-mc-input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  margin: 0;
  padding: 4px 8px 0 14px;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  background: transparent;
  font-family: var(--dsw-font-family);
  font-size: inherit;
  line-height: inherit;
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-state-business-primary);
}
.dshb-mc[data-variant="hero"] .dshb-mc-input {
  min-height: 52px;
}
.dshb-mc-input::placeholder {
  color: var(--dsw-alias-label-caption);
}
.dshb-mc-input:disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: not-allowed;
}
.dshb-mc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 8px 6px;
}
.dshb-mc-add {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: var(--dsw-specific-selector);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dshb-mc-add:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (hover: hover) {
  .dshb-mc-add:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-solid);
  }
  .dshb-mc-primary:hover:not(:disabled) {
    background: var(--dsw-alias-button-info-hover);
  }
}
.dshb-mc-primary {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  margin-left: auto;
  border: none;
  border-radius: 999px;
  background: var(--dsw-alias-button-info-fill);
  color: var(--dsw-alias-label-on-color);
  cursor: pointer;
  transform: translateY(-2px);
}
.dshb-mc-primary:disabled {
  opacity: 0.4;
  cursor: default;
}
.dshb-mc-primary[data-sending]:disabled {
  opacity: 1;
  cursor: progress;
}
`
