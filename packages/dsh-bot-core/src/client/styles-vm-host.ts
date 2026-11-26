export const VM_HOST_CSS = `
.dshb-vm-host-command { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshb-vm-host-command .dshb-ui-code { white-space: pre-wrap; overflow-wrap: anywhere; }
.dshb-vm-host-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.dshb-vm-host-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshb-vm-host-tags { display: flex; align-items: center; gap: 6px; }
.dshb-vm-host-fix { overflow-wrap: anywhere; }
[data-dshb-vm-host-pairing] .dshb-ui-row-block .dshb-ui-code,
[data-dshb-host-key] .dshb-ui-row-block .dshb-ui-code,
[data-dshb-ssh] .dshb-ui-row-block .dshb-ui-code { white-space: normal; overflow-wrap: anywhere; }
.dshb-vm-host-facts { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dshb-vm-host-changes { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshb-vm-host-log {
  margin: 0;
  max-height: 180px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-markdown-inline-code);
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dshb-vm-host-log[data-size="page"] { max-height: min(60vh, 560px); margin: 0 16px 12px; }
`
