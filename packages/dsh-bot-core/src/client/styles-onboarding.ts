const ACCENT = "var(--dsw-alias-state-business-primary)"
const ACCENT_2 = "var(--dsw-alias-onboarding-accent, var(--dsw-alias-state-business-primary))"
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)"

export const ONBOARDING_CSS = `
.dshb-onboard-root {
  pointer-events: auto;
  position: fixed;
  inset: 0;
  z-index: 1010;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dshb-onboard-mask {
  position: absolute;
  inset: 0;
  backdrop-filter: var(--dsw-mask-blur);
  background: var(--dsw-alias-bg-mask-1);
  animation: dshb-enter 200ms ease;
}
.dshb-onboard {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  width: min(940px, 100%);
  height: min(640px, calc(100dvh - 48px));
  overflow: hidden;
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  animation: dshb-onboard-rise 420ms ${EASE};
}
@keyframes dshb-onboard-rise { from { opacity: 0; transform: translateY(16px) scale(0.985); } }
.dshb-onboard-art {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 20% 10%, color-mix(in srgb, ${ACCENT} 26%, transparent), transparent 60%),
    radial-gradient(90% 80% at 90% 100%, color-mix(in srgb, ${ACCENT_2} 30%, transparent), transparent 62%),
    var(--dsw-alias-bg-layer-1);
}
.dshb-onboard-art::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent) 1px, transparent 1px);
  background-size: 18px 18px;
  mask-image: radial-gradient(70% 70% at 50% 50%, black, transparent);
  pointer-events: none;
}
.dshb-onboard-art-inner {
  position: relative;
  z-index: 1;
  width: min(100%, 380px);
  padding: 24px;
  animation: dshb-onboard-art-in 520ms ${EASE};
}
@keyframes dshb-onboard-art-in { from { opacity: 0; transform: scale(0.92) rotate(-2deg); } }
.dshb-art { display: block; width: 100%; height: auto; overflow: visible; }
.dshb-art-halo { fill: color-mix(in srgb, ${ACCENT} 10%, transparent); }
.dshb-art-card { fill: var(--dsw-alias-bg-layer-2); stroke: var(--dsw-alias-border-l3); stroke-width: 1; filter: drop-shadow(0 6px 14px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent)); }
.dshb-art-host { fill: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); stroke: var(--dsw-alias-border-l3); }
.dshb-art-text { fill: color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }
.dshb-art-bar { fill: color-mix(in srgb, ${ACCENT} 50%, transparent); }
.dshb-art-bubble { fill: color-mix(in srgb, ${ACCENT} 14%, transparent); }
.dshb-art-bubble-strong { fill: ${ACCENT}; opacity: 0.85; }
.dshb-art-bubble-strong + g .dshb-art-text, .dshb-art-bubble-strong ~ .dshb-art-text { fill: color-mix(in srgb, var(--dsw-alias-label-primary-foreground) 70%, transparent); }
.dshb-art-tail { fill: var(--dsw-alias-bg-layer-2); stroke: var(--dsw-alias-border-l3); stroke-width: 1; }
.dshb-art-bot[data-tone="a"] .dshb-art-fill { fill: ${ACCENT}; }
.dshb-art-bot[data-tone="b"] .dshb-art-fill { fill: ${ACCENT_2}; }
.dshb-art-bot[data-tone="c"] .dshb-art-fill { fill: var(--dsw-alias-state-success-primary); }
.dshb-art-eye { fill: var(--dsw-alias-bg-layer-2); }
.dshb-art-smile { fill: none; stroke: var(--dsw-alias-bg-layer-2); stroke-width: 2.4; stroke-linecap: round; }
.dshb-art-sparkle { fill: ${ACCENT_2}; animation: dshb-art-twinkle 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes dshb-art-twinkle { 50% { opacity: 0.35; transform: scale(0.7); } }
.dshb-art-link { stroke: color-mix(in srgb, ${ACCENT} 45%, transparent); stroke-width: 1.5; stroke-dasharray: 4 5; animation: dshb-art-flow 1.6s linear infinite; }
@keyframes dshb-art-flow { to { stroke-dashoffset: -18; } }
.dshb-art-node { fill: var(--dsw-alias-bg-layer-2); stroke: var(--dsw-alias-border-l3); }
.dshb-art-ring { fill: none; stroke: color-mix(in srgb, ${ACCENT} 55%, transparent); stroke-width: 2; }
.dshb-art-glyph { fill: none; stroke: var(--dsw-alias-label-secondary); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
.dshb-art-wide { stroke-width: 2; stroke: color-mix(in srgb, ${ACCENT} 70%, var(--dsw-alias-label-secondary)); }
.dshb-art-hand { fill: none; stroke: ${ACCENT}; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.dshb-art-shield { fill: color-mix(in srgb, ${ACCENT} 16%, var(--dsw-alias-bg-layer-2)); stroke: color-mix(in srgb, ${ACCENT} 55%, transparent); stroke-width: 2; }
.dshb-art-plus-bg { fill: var(--dsw-alias-state-success-primary); }
.dshb-art-warn { fill: var(--dsw-alias-state-warn-primary); }
.dshb-art-plus { fill: none; stroke: var(--dsw-alias-bg-layer-2); stroke-width: 3.2; stroke-linecap: round; }
.dshb-art-dim { fill: var(--dsw-alias-label-tertiary); }
.dshb-art-float { animation: dshb-art-float 3.6s ease-in-out infinite alternate; }
@keyframes dshb-art-float { to { transform: translateY(-6px); } }
.dshb-onboard-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.dshb-onboard-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 44px 44px 16px;
}
.dshb-onboard-body > .dshb-ui-group { margin-top: 0; }
.dshb-onboard-body { mask-image: linear-gradient(to bottom, black calc(100% - 16px), transparent); }
.dshb-onboard-body[data-centered] { justify-content: center; padding-bottom: 32px; }
.dshb-onboard-main[data-direction="forward"] .dshb-onboard-body { animation: dshb-onboard-forward 380ms ${EASE}; }
.dshb-onboard-main[data-direction="back"] .dshb-onboard-body { animation: dshb-onboard-back 380ms ${EASE}; }
@keyframes dshb-onboard-forward { from { opacity: 0; transform: translateX(28px); } }
@keyframes dshb-onboard-back { from { opacity: 0; transform: translateX(-28px); } }
.dshb-onboard-heading { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.dshb-onboard-eyebrow {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: ${ACCENT};
}
.dshb-onboard-title {
  margin: 0;
  font-size: 28px;
  line-height: 36px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--dsw-alias-label-primary);
}
.dshb-onboard-lead {
  margin: 0;
  max-width: 46ch;
  font-size: 15px;
  line-height: 24px;
  color: var(--dsw-alias-label-secondary);
}
.dshb-onboard-features {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.dshb-onboard-feature {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--dsw-alias-border-l3);
  background: linear-gradient(160deg, color-mix(in srgb, ${ACCENT} 7%, var(--dsw-alias-bg-layer-1)), var(--dsw-alias-bg-layer-1) 70%);
  animation: dshb-onboard-pop 420ms ${EASE} both;
}
.dshb-onboard-feature-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: linear-gradient(135deg, ${ACCENT}, ${ACCENT_2});
  box-shadow: 0 6px 16px color-mix(in srgb, ${ACCENT} 30%, transparent);
}
.dshb-feature-glyph { fill: none; stroke: var(--dsw-alias-label-primary-foreground); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.dshb-onboard-feature-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dshb-onboard-feature-title { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dshb-onboard-feature-detail { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshb-onboard-channel { display: flex; flex-direction: column; gap: 12px; }
.dshb-onboard-channel > .dshb-ui-group { margin-top: 0; }
.dshb-onboard-steps {
  margin: 0;
  padding: 12px 16px 12px 36px;
  border-radius: 12px;
  background: color-mix(in srgb, ${ACCENT} 6%, var(--dsw-alias-bg-layer-1));
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.dshb-onboard-steps li::marker { color: ${ACCENT}; font-weight: 600; }
@keyframes dshb-onboard-pop { from { opacity: 0; transform: translateY(6px); } }
.dshb-onboard-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-state-business-primary);
  text-decoration: none;
}
.dshb-onboard-link:hover { text-decoration: underline; }
.dshb-onboard-link:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
  border-radius: 4px;
}
.dshb-onboard-status { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; color: var(--dsw-alias-label-secondary); }
.dshb-onboard-creating { justify-content: center; }
.dshb-onboard-creating .dshb-progress-card { margin: 0 auto; }
.dshb-onboard-dots { order: 1; display: flex; justify-content: center; gap: 6px; padding: 4px 0 0; }
.dshb-onboard-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  transition: width 300ms ${EASE}, background-color 300ms ease;
}
.dshb-onboard-dot[data-current] { width: 22px; background: ${ACCENT}; }
.dshb-onboard-actions {
  order: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 44px 28px;
}
.dshb-onboard-actions > :first-child { margin-right: auto; }
.dshb-onboard-spacer { flex: 1; }
@media (max-width: 760px) {
  .dshb-onboard-features { grid-template-columns: minmax(0, 1fr); }
  .dshb-onboard { grid-template-columns: minmax(0, 1fr); grid-template-rows: 180px minmax(0, 1fr); }
  .dshb-onboard-art-inner { box-sizing: border-box; width: 100%; height: 100%; padding: 12px; display: flex; justify-content: center; }
  .dshb-onboard-art-inner .dshb-art { width: auto; height: 100%; max-width: 100%; }
  .dshb-onboard-body { padding: 24px 24px 12px; }
  .dshb-onboard-actions { padding: 12px 24px 20px; flex-wrap: wrap; }
  .dshb-onboard-title { font-size: 22px; line-height: 30px; }
}
@media (max-width: 640px) {
  .dshb-onboard-root { padding: 0; }
  .dshb-onboard { width: 100%; height: 100dvh; border-radius: 0; grid-template-rows: 150px minmax(0, 1fr); }
}
.dshb-modal.dshb-release { width: min(520px, 100%); padding-top: 0; }
.dshb-release-banner {
  position: relative;
  height: 88px;
  margin-bottom: -20px;
  overflow: hidden;
  background:
    radial-gradient(80% 140% at 15% 0%, color-mix(in srgb, ${ACCENT} 40%, transparent), transparent 70%),
    radial-gradient(70% 120% at 100% 100%, color-mix(in srgb, ${ACCENT_2} 40%, transparent), transparent 70%),
    var(--dsw-alias-bg-layer-1);
}
.dshb-release-glow {
  position: absolute;
  top: 20px;
  left: 24px;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, ${ACCENT}, ${ACCENT_2});
  box-shadow: 0 8px 24px color-mix(in srgb, ${ACCENT} 40%, transparent);
  animation: dshb-onboard-pop 520ms ${EASE};
  display: flex;
  align-items: center;
  justify-content: center;
}
.dshb-release-glow svg { fill: var(--dsw-alias-label-primary-foreground); }
.dshb-release-body {
  max-height: min(56vh, 460px);
  overflow-y: auto;
  gap: 20px;
  padding-bottom: 20px;
  mask-image: linear-gradient(to bottom, black calc(100% - 24px), transparent);
  scrollbar-gutter: stable;
}
.dshb-release-version { margin: 0 0 8px; font-size: 13px; line-height: 20px; font-weight: 600; }
.dshb-release-version a { color: var(--dsw-alias-label-tertiary); text-decoration: none; }
.dshb-release-version a:hover { color: ${ACCENT}; text-decoration: underline; }
.dshb-release-markdown { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dshb-release-markdown > :first-child { margin-top: 0; }
.dshb-release-markdown > :last-child { margin-bottom: 0; }
.dshb-release-markdown h1, .dshb-release-markdown h2, .dshb-release-markdown h3, .dshb-release-markdown h4 { margin: 16px 0 6px; font-size: 15px; line-height: 22px; font-weight: 600; }
.dshb-release-markdown p { margin: 0 0 10px; }
.dshb-release-markdown ul, .dshb-release-markdown ol { margin: 0 0 10px; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.dshb-release-markdown li::marker { color: ${ACCENT}; }
.dshb-release-markdown a { color: var(--dsw-alias-state-business-primary); }
.dshb-release-markdown code { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 0.9em; }
.dshb-release-markdown pre { margin: 0 0 10px; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-markdown-code-block); overflow-x: auto; }
.dshb-release-markdown blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 2px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); }
.dshb-release-markdown hr { border: none; border-top: 0.5px solid var(--dsw-alias-border-l3); }
@media (prefers-reduced-motion: reduce) {
  .dshb-onboard, .dshb-onboard-mask, .dshb-onboard-art-inner, .dshb-onboard-body, .dshb-onboard-feature,
  .dshb-art-sparkle, .dshb-art-link, .dshb-art-float, .dshb-release-glow,
  .dshb-onboard-main[data-direction] .dshb-onboard-body { animation: none; }
  .dshb-onboard-dot { transition: none; }
}
`
