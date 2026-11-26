/** The overlay frame (ui/OverlayFrame.tsx): a large popover over the app with a mask and a one-line header; a sheet on a compact window. */
export const OVERLAY_CSS = `
.dshb-overlay-root {
  pointer-events: auto;
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px;
}
.dshb-overlay-root[data-covered] { visibility: hidden; }
.dshb-overlay-mask {
  position: absolute;
  inset: var(--dsh-frame-chrome-top, 0px) 0 0;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
  animation: dshb-enter var(--ds-transition-duration, 150ms) var(--ds-ease-in-out, ease);
}
.dshb-overlay {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  overflow: hidden;
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  animation: dshb-enter var(--ds-transition-duration, 150ms) var(--ds-ease-in-out, ease);
}
.dshb-overlay:focus { outline: none; }
@media (prefers-reduced-motion: reduce) {
  .dshb-overlay, .dshb-overlay-mask { animation: none; }
}
.dshb-overlay-header {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 56px;
  padding: 0 14px 0 24px;
}
.dshb-overlay-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dshb-overlay-header .dshb-ui-button[data-variant="icon"] { color: var(--dsw-alias-label-primary); }
.dshb-overlay-root[data-layout="compact"] { padding: 0; align-items: stretch; }
.dshb-overlay-root[data-layout="compact"] .dshb-overlay-mask { display: none; }
.dshb-overlay-root[data-layout="compact"] .dshb-overlay {
  width: 100%;
  margin-top: var(--dsh-frame-chrome-top, 0px);
  border-radius: 0;
  box-shadow: none;
}
.dshb-overlay-root[data-layout="compact"] .dshb-overlay-header { padding: 0 12px 0 16px; }
.dshb-overlay-root[data-layout="compact"] .dshb-overlay-header > .dshb-ui-button:first-child { margin-left: -8px; }
`
