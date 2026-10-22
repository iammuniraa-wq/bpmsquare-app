import { describe, expect, it } from "vitest";
import {
  DOCK_BOTTOM, DOCK_BOTTOM_SHORT, DOCK_HEIGHT_SHARE, DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT, DOCK_PANEL_CSS, DOCK_SHEET_BELOW,
  DOCK_SHORT_VIEWPORT, DOCK_TOP_GAP, DOCK_WIDTH, dockHeightPx, dockTopPx,
} from "./dockLayout";

// The dock panel's size (owner request 2026-10-22: taller and a little wider, yet always inside the window). The numbers
// below are the stylesheet's own constants run through the same formula the CSS clamp() resolves to.

const TOP_BAR = 48;

describe("the panel's height", () => {
  it("1440 x 900: min(78% of the window, 720 px) and the top bar stays visible", () => {
    const h = dockHeightPx(900);
    expect(h).toBeCloseTo(900 * DOCK_HEIGHT_SHARE, 5);
    expect(h).toBeLessThanOrEqual(DOCK_MAX_HEIGHT);
    expect(h).toBeGreaterThan(650);
    expect(dockTopPx(900)).toBeGreaterThanOrEqual(TOP_BAR);
  });

  it("a tall window stops at 720 px", () => {
    expect(dockHeightPx(1400)).toBe(DOCK_MAX_HEIGHT);
    expect(dockTopPx(1400)).toBeGreaterThanOrEqual(TOP_BAR);
  });

  it("1280 x 495 (the owner's browser pane): the panel takes the launcher's place, is taller than the old ~320 px and clears the top bar", () => {
    const h = dockHeightPx(495);
    expect(h).toBeGreaterThanOrEqual(DOCK_MIN_HEIGHT);
    expect(h).toBeGreaterThan(330);
    expect(dockTopPx(495)).toBeGreaterThanOrEqual(TOP_BAR);
    // The bottom edge sits DOCK_BOTTOM_SHORT above the window's bottom edge.
    expect(495 - dockTopPx(495) - h).toBeCloseTo(DOCK_BOTTOM_SHORT, 5);
  });

  it("never crosses the window at any laptop height, and keeps the minimum wherever the window allows it", () => {
    for (let vh = 420; vh <= 1600; vh += 10) {
      expect(dockTopPx(vh), `${vh}`).toBeGreaterThanOrEqual(TOP_BAR);
      expect(dockHeightPx(vh), `${vh}`).toBeLessThanOrEqual(DOCK_MAX_HEIGHT);
      const room = vh - (vh <= DOCK_SHORT_VIEWPORT ? DOCK_BOTTOM_SHORT : DOCK_BOTTOM) - DOCK_TOP_GAP;
      expect(dockHeightPx(vh), `${vh}`).toBeGreaterThanOrEqual(Math.min(DOCK_MIN_HEIGHT, room));
    }
  });

  it("a tab-bar or safe-area lift under the panel shrinks it instead of pushing it off the top", () => {
    expect(dockTopPx(900, 58)).toBeGreaterThanOrEqual(TOP_BAR);
    expect(dockHeightPx(900, 58)).toBeLessThan(dockHeightPx(900, 0) + 1);
  });
});

describe("the stylesheet", () => {
  it("is built from the same constants: 440 px wide, at most 92vw, the height clamp, the 122 px bottom", () => {
    expect(DOCK_WIDTH).toBe(440);
    expect(DOCK_PANEL_CSS).toContain(`width: ${DOCK_WIDTH}px`);
    expect(DOCK_PANEL_CSS).toContain("max-width: min(92vw, calc(100vw - 44px))");
    expect(DOCK_PANEL_CSS).toContain(`--dock-bottom: ${DOCK_BOTTOM}px`);
    expect(DOCK_PANEL_CSS).toContain(`min(${DOCK_MAX_HEIGHT}px, var(--dock-cap))`);
    expect(DOCK_PANEL_CSS).toContain(`min(${DOCK_MIN_HEIGHT}px, var(--dock-cap))`);
    expect(DOCK_PANEL_CSS).toContain(`calc(var(--dock-vh) * ${DOCK_HEIGHT_SHARE})`);
    expect(DOCK_PANEL_CSS).toContain(`- ${DOCK_TOP_GAP}px)`);
  });

  it("uses the dynamic viewport height where the browser has it", () => {
    expect(DOCK_PANEL_CSS).toMatch(/@supports \(height: 1dvh\) \{ \.bms-dock-panel \{ --dock-vh: 100dvh; \} \}/);
  });

  it("a short desktop window moves the panel to the corner, hides the launcher behind it and keeps the suggestions on one row", () => {
    const m = DOCK_PANEL_CSS.match(new RegExp(`@media \\(min-width: ${DOCK_SHEET_BELOW}px\\) and \\(max-height: ${DOCK_SHORT_VIEWPORT}px\\) \\{([\\s\\S]*?)\\n  \\}`));
    expect(m).not.toBeNull();
    expect(m![1]).toContain(`--dock-bottom: ${DOCK_BOTTOM_SHORT}px`);
    expect(m![1]).toContain('[data-dock-open="true"] { display: none !important; }');
    expect(m![1]).toContain("flex-wrap: nowrap !important");
  });

  it("under 900 px the panel is the whole screen, the input row is pinned and every control is a 44 px target", () => {
    const m = DOCK_PANEL_CSS.match(new RegExp(`@media \\(max-width: ${DOCK_SHEET_BELOW - 1}px\\) \\{([\\s\\S]*)\\n  \\}`));
    expect(m).not.toBeNull();
    const phone = m![1];
    expect(phone).toContain("inset: 0 !important");
    expect(phone).toContain("height: 100dvh !important");
    expect(phone).toContain("max-width: none !important");
    expect(phone).toContain("min-height: 0 !important");
    expect(phone).toMatch(/\.bms-dock-chip, \.bms-dock-row, \.bms-dock-send, \.bms-dock-close[^{]*\{ min-height: 44px; min-width: 44px; \}/);
    expect(phone).toContain(".bms-dock-panel .bms-brief-refresh");
    expect(phone).toContain("padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px))");
  });

  it("the sheet rules come last so they win over the desktop size at the same specificity", () => {
    expect(DOCK_PANEL_CSS.indexOf("max-width: 899px")).toBeGreaterThan(DOCK_PANEL_CSS.indexOf("height: clamp("));
  });
});
