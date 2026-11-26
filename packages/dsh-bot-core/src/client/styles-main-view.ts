/** The Main view (docs/specs/bot-main-view.md §5): the timeline in the conversation column, and the Session log panel. */
export const MAIN_VIEW_CSS = `
.dshb-mv {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  padding: 24px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 32px;
  box-sizing: border-box;
}
.dshb-mv-column {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--dsh-chat-content-width, 760px);
  margin: 0 auto;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
}
.dshb-mv-status {
  margin: 8px 0;
  text-align: center;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-mv-beginning {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 0 16px;
}
.dshb-mv-beginning-name { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }
.dshb-mv-earlier-failed { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 8px 0; }
.dshb-mv-earlier-failed .dshb-ui-error { margin: 0; }
.dshb-mv-day {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-mv-day::before, .dshb-mv-day::after {
  content: "";
  flex: 1;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
}
.dshb-mv-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-mv-meta .dshb-ui-tag { align-self: center; }
.dshb-mv-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshb-mv-route, .dshb-mv-time { white-space: nowrap; }
.dshb-mv-person {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  margin-top: 16px;
}
.dshb-mv-person .dshb-mv-meta { justify-content: flex-end; padding: 0 4px; }
.dshb-mv-message {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%);
}
.dshb-mv-bubble {
  max-width: 100%;
  box-sizing: border-box;
  padding: 10px 16px;
  border-radius: var(--dsw-radius-xl, 20px);
  background: var(--dsw-specific-bubble);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dshb-mv-images, .dshb-mv-files { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.dshb-mv-bot .dshb-mv-files { justify-content: flex-start; margin-top: 4px; }
.dshb-mv-thumb {
  display: inline-grid;
  place-items: center;
  overflow: hidden;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-tertiary);
}
.dshb-mv-thumb img { display: block; object-fit: cover; }
.dshb-mv-thumb[data-state="failed"] { color: var(--dsw-alias-state-error-primary); }
.dshb-mv-file {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  max-width: 260px;
  min-width: 140px;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-specific-input-major, transparent);
  font: inherit;
  text-align: left;
  color: var(--dsw-alias-label-primary);
}
button.dshb-mv-file { cursor: pointer; }
@media (hover: hover) {
  button.dshb-mv-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshb-mv-file-name {
  max-width: 100%;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshb-mv-file-meta {
  max-width: 100%;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshb-mv-bot, .dshb-mv-typing {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  column-gap: 12px;
  margin-top: 16px;
}
.dshb-mv-avatar { display: flex; padding-top: 2px; }
.dshb-mv-bot-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshb-mv-reply + .dshb-mv-reply { margin-top: 8px; }
.dshb-mv-markdown { overflow-wrap: anywhere; }
.dshb-mv-markdown > :first-child { margin-top: 0; }
.dshb-mv-markdown > :last-child { margin-bottom: 0; }
.dshb-mv-markdown p, .dshb-mv-markdown ul, .dshb-mv-markdown ol, .dshb-mv-markdown pre, .dshb-mv-markdown blockquote { margin: 0 0 12px; }
.dshb-mv-markdown h1, .dshb-mv-markdown h2, .dshb-mv-markdown h3, .dshb-mv-markdown h4, .dshb-mv-markdown h5, .dshb-mv-markdown h6 {
  margin: 16px 0 8px;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}
.dshb-mv-markdown ul, .dshb-mv-markdown ol { padding-left: 22px; }
.dshb-mv-markdown li + li { margin-top: 2px; }
.dshb-mv-markdown a { color: var(--dsw-alias-state-business-primary); }
.dshb-mv-markdown code { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 0.9em; }
.dshb-mv-markdown pre {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-markdown-code-block);
  overflow-x: auto;
}
.dshb-mv-markdown blockquote {
  padding-left: 12px;
  border-left: 2px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
}
.dshb-mv-markdown hr { border: none; border-top: 0.5px solid var(--dsw-alias-border-l3); }
.dshb-mv-note { margin: 4px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshb-mv-turn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0 40px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dshb-mv-turn-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-caption);
}
.dshb-mv-turn[data-outcome="failed"] { color: var(--dsw-alias-state-error-primary); }
.dshb-mv-turn[data-outcome="failed"] .dshb-mv-turn-dot { background: var(--dsw-alias-state-error-primary); }
.dshb-mv-dots { display: inline-flex; align-items: center; gap: 4px; height: 30px; }
.dshb-mv-dots > span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  animation: dshb-mv-dot 1.2s ease-in-out infinite;
}
.dshb-mv-dots > span:nth-child(2) { animation-delay: 0.15s; }
.dshb-mv-dots > span:nth-child(3) { animation-delay: 0.3s; }
@keyframes dshb-mv-dot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}
@media (prefers-reduced-motion: reduce) {
  .dshb-mv-dots > span { animation: none; opacity: 0.6; }
}
@media (max-width: 640px) {
  .dshb-mv { padding: 16px 16px 24px; }
  .dshb-mv-message { max-width: 88%; }
}
.dshb-session-log {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  --dsh-chat-content-width: min(calc(100% - 32px), 920px);
  --dsh-composer-side-clearance: 8px;
}
`
