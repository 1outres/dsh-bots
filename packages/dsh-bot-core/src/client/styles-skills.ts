export const SKILLS_CSS = `
.dshb-skills-usage { color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
.dshb-skills-diff {
  margin: 0;
  padding: 8px 12px;
  max-height: 420px;
  overflow: auto;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-markdown-code-block);
}
.dshb-skills-line { display: block; }
.dshb-skills-line-added { color: var(--dsw-alias-state-success-primary); }
.dshb-skills-line-removed { color: var(--dsw-alias-state-error-primary); }
.dshb-skills-line-same { color: var(--dsw-alias-label-secondary); }
`
