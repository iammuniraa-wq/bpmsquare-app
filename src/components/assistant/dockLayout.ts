// The dock panel's size, in one place so the stylesheet and its tests read the same numbers (owner request 2026-10-22:
// the panel showed about four lines of a card). Desktop: height = min(78% of the window, 720px), never above the room
// between the launcher and the top bar, never below a working minimum unless the window itself is shorter than that.
// Under 900 px the panel is the whole screen (a sheet), as before.

export const DOCK_WIDTH = 440;
export const DOCK_MAX_HEIGHT = 720;
export const DOCK_MIN_HEIGHT = 380;
export const DOCK_HEIGHT_SHARE = 0.78;
/** The top bar is 48 px; the panel stops 16 px below it, so the bar is always visible. */
export const DOCK_TOP_GAP = 64;
/** Panel bottom edge above the launcher (52) and its on/off switch. */
export const DOCK_BOTTOM = 122;
/** In a short window the panel takes the launcher's place (the header has the close button) to keep room for the chat. */
export const DOCK_BOTTOM_SHORT = 12;
export const DOCK_SHORT_VIEWPORT = 700;
export const DOCK_SHEET_BELOW = 900;

/** The panel height the stylesheet resolves to, for a window `vh` px tall; `floor` is the safe-area/tab-bar lift under the panel. */
export function dockHeightPx(vh: number, floor = 0): number {
  const bottom = vh <= DOCK_SHORT_VIEWPORT ? DOCK_BOTTOM_SHORT : DOCK_BOTTOM;
  const cap = vh - bottom - floor - DOCK_TOP_GAP;
  return Math.max(Math.min(DOCK_MIN_HEIGHT, cap), Math.min(vh * DOCK_HEIGHT_SHARE, DOCK_MAX_HEIGHT, cap));
}

/** Where the panel's top edge lands, measured from the top of the window. */
export const dockTopPx = (vh: number, floor = 0): number =>
  vh - (vh <= DOCK_SHORT_VIEWPORT ? DOCK_BOTTOM_SHORT : DOCK_BOTTOM) - floor - dockHeightPx(vh, floor);

export const DOCK_PANEL_CSS = `
  .bms-dock-panel {
    --dock-vh: 100vh; --dock-bottom: ${DOCK_BOTTOM}px;
    --dock-cap: calc(var(--dock-vh) - var(--dock-bottom) - var(--dock-floor, 0px) - ${DOCK_TOP_GAP}px);
    position: fixed; right: 22px; bottom: calc(var(--dock-bottom) + var(--dock-floor, 0px)); z-index: 300;
    width: ${DOCK_WIDTH}px; max-width: min(92vw, calc(100vw - 44px));
    height: clamp(min(${DOCK_MIN_HEIGHT}px, var(--dock-cap)), calc(var(--dock-vh) * ${DOCK_HEIGHT_SHARE}), min(${DOCK_MAX_HEIGHT}px, var(--dock-cap)));
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--card-bg, #fff); border: 1px solid var(--line);
    border-radius: var(--card-radius, 10px); box-shadow: 0 24px 60px rgba(10,15,25,.28);
  }
  @supports (height: 1dvh) { .bms-dock-panel { --dock-vh: 100dvh; } }
  @media (min-width: ${DOCK_SHEET_BELOW}px) and (max-height: ${DOCK_SHORT_VIEWPORT}px) {
    .bms-dock-panel { --dock-bottom: ${DOCK_BOTTOM_SHORT}px; }
    .bms-dock-suggest { flex-wrap: nowrap !important; overflow-x: auto; }
    [data-dock-open="true"] { display: none !important; }
  }
  /* Phone and narrow tablet: the panel is the whole screen, the input row stays pinned at its bottom edge and
     every control is at least 44 px. The launcher hides behind it, so the header carries a Close button. */
  @media (max-width: ${DOCK_SHEET_BELOW - 1}px) {
    .bms-dock-panel {
      inset: 0 !important; width: 100% !important; max-width: none !important; min-height: 0 !important;
      height: 100dvh !important; border-radius: 0 !important; border: none !important;
      padding-top: env(safe-area-inset-top, 0px);
    }
    .bms-dock-input { padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px)) !important; border-top: 1px solid var(--line); }
    .bms-dock-chip, .bms-dock-row, .bms-dock-send, .bms-dock-close, .bms-dock-panel .bms-brief-refresh, .bms-dock-panel .bms-brief-more { min-height: 44px; min-width: 44px; }
    .bms-dock-chip-wrap { max-width: 100%; }
    [data-dock-open="true"] { display: none !important; }
  }
`;
