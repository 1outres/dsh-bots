export const SPACES_CSS = `
.dshb-space-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-0);
}
.dshb-space-header { gap: 4px; }
.dshb-space-header .dshb-shell-title { gap: 8px; }
.dshb-space-title { flex: 0 1 auto; }
.dshb-space-meta {
  flex: none;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-space-banner { flex: none; padding: 8px 16px 0; }
.dshb-space-frame {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  border: none;
  background: var(--dsw-alias-bg-layer-0);
}
.dshb-space-panel > .dshb-ui-empty { flex: 1 1 auto; }
.dshb-spaces-row .dshb-spaces-chevron { display: inline-flex; color: var(--dsw-alias-label-caption); }
.dshb-spaces-row .dshb-spaces-chevron svg { transition: transform 150ms var(--ds-ease-in-out, ease); }
.dshb-spaces-row .dshb-toggle[data-open] .dshb-spaces-chevron svg { transform: rotate(90deg); }
.dshb-spaces-count {
  flex: none;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-space-row { padding-inline-start: calc(var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px) + 22px); }
.dshb-space-row .dshb-ui-tag { flex: none; }
.dshb-spaces-settings { display: flex; flex-direction: column; }
.dshb-space-link-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dshb-space-link-form > .dshb-ui-field { flex: 1 1 200px; }
`
