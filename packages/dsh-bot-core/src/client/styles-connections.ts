export const CONNECTIONS_CSS = `
.dshb-account-letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--dsw-alias-interactive-bg-hover);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dshb-account-rename { display: inline-flex; min-width: 0; }
[data-dshb-connections] .dshb-ui-group-frame > .dshb-ui-add-row {
  border-top: var(--dsh-hairline-width, 0.5px) solid var(--dsw-alias-border-l4);
}
.dshb-connect-actions[data-kind="plain"] { justify-content: flex-end; gap: 8px; }
`
