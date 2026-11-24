/** Connectors' panels in the shell's side panel frame (styles-shell.ts): the connector's note and the body. */
export const CONNECTOR_PANELS_CSS = `
.dshb-cpanel-note {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 50%;
  overflow: hidden;
  margin-right: 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshb-cpanel-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.dshb-cpanel-body > [data-slot] { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.dshb-cpanel-body > .dshb-ui-empty { flex: 1 1 auto; }
.dshb-cpanel-body .dshb-ui-empty-detail { width: min(360px, 100%); }
`
