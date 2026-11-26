export const CONNECTORS_CSS = `
[data-dshb-connector-tools] > .dshb-ui-group-head {
  position: sticky;
  top: -8px;
  z-index: 2;
  margin: 0 -4px 0;
  padding: 8px 8px 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.dshb-tools-bar { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.dshb-tools-filter { width: 200px; height: 28px; color: var(--dsw-alias-label-tertiary); }
.dshb-tools-filter .dshb-ui-field-input { font-size: 13px; }
.dshb-tools-filter .dshb-ui-field-input::-webkit-search-cancel-button { display: none; }
.dshb-tools-exception-draft { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshb-tools-exception-draft .dshb-ui-segmented { margin-left: auto; }
@media (max-width: 640px) {
  .dshb-tools-filter { width: 140px; }
  [data-dshb-connector-settings] .dshb-ui-field[data-width="regular"] { width: 140px; }
}
`
