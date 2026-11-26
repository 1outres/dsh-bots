export const SETTINGS_CSS = `
.dshb-settings {
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  grid-template-rows: 56px minmax(0, 1fr);
  grid-template-areas:
    "header header"
    "nav page";
  column-gap: 12px;
  width: min(960px, calc(100vw - 48px));
  height: min(820px, calc(100dvh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px))));
}
.dshb-settings > .dshb-overlay-header { grid-area: header; }
.dshb-settings-nav {
  grid-area: nav;
  min-height: 0;
  padding: 0 0 12px 12px;
  overflow-y: auto;
}
.dshb-settings-nav [role="tablist"] { display: flex; flex-direction: column; gap: 4px; }
.dshb-settings-tab {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 40px;
  padding: 9px 16px 9px 12px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  text-align: left;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
@media (hover: hover) {
  .dshb-settings-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshb-settings-tab[aria-selected="true"] { background: var(--dsw-specific-sidebar-nav-item-active); }
.dshb-settings-tab:focus-visible,
.dshb-settings-list-row:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshb-settings-tab[data-dshb-settings-tab="bot-core.danger"] { color: var(--dsw-alias-state-error-primary); }
.dshb-settings-tab-icon { flex: none; display: inline-flex; }
.dshb-settings-tab-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshb-settings-badge { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.dshb-settings-badge[data-tone="danger"] { background: var(--dsw-alias-state-error-primary); }
.dshb-settings-badge[data-tone="warning"] { background: var(--dsw-alias-state-warn-primary); }
.dshb-settings-page {
  grid-area: page;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 32px 32px 12px;
}
.dshb-settings-content { display: flex; flex-direction: column; min-width: 0; }
.dshb-settings-page[data-dshb-settings-empty] { grid-column: 1 / -1; }
.dshb-settings-list-row {
  width: 100%;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshb-settings-list-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshb-settings-list-row .dshb-settings-tab-label { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dshb-settings-list-row .dshb-settings-tab-icon { color: var(--dsw-alias-label-secondary); }
.dshb-overlay-root[data-layout="compact"] .dshb-settings {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    "header"
    "page";
  height: auto;
}
.dshb-overlay-root[data-layout="compact"] .dshb-settings-page { padding: 8px 16px 24px; }
.dshb-dsh-settings { display: flex; flex-direction: column; }
.dshb-settings-groups { display: flex; flex-direction: column; min-width: 0; }
.dshb-settings-groups > .dshb-ui-page-title + .dshb-ui-group { margin-top: 8px; }
.dshb-general-identity[data-kind="block"] { flex-direction: row; align-items: flex-start; gap: 16px; padding: 16px; }
.dshb-general-preview { flex: none; display: inline-flex; }
.dshb-environment-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.dshb-environment-unit { min-width: 36px; color: var(--dsw-alias-label-secondary, inherit); }
.dshb-general-fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.dshb-models-route { display: flex; align-items: center; justify-content: flex-end; gap: 8px; width: 380px; min-width: 0; max-width: 100%; }
.dshb-models-route .dshb-ui-search-select { flex: 1 1 0; min-width: 0; }
.dshb-models-route button.dshb-ui-select { width: 100%; min-width: 0; }
.dshb-models-route .dshb-ui-select:not(button) { flex: none; min-width: 0; width: 140px; }
.dshb-ui-row-block > .dshb-models-route { justify-content: flex-start; }
[data-dshb-model-role] > .dshb-ui-row-trailing,
[data-dshb-create-model] > .dshb-ui-row-trailing { flex: 0 1 auto; max-width: 75%; }
@media (max-width: 640px) {
  [data-dshb-model-role], [data-dshb-create-model] { flex-wrap: wrap; }
  [data-dshb-model-role] > .dshb-ui-row-trailing,
  [data-dshb-create-model] > .dshb-ui-row-trailing { flex-basis: 100%; max-width: 100%; justify-content: flex-start; flex-wrap: wrap; }
  .dshb-models-route { width: 100%; }
  .dshb-general-identity[data-kind="block"] { flex-direction: column; }
  .dshb-general-fields { align-self: stretch; }
}
`
