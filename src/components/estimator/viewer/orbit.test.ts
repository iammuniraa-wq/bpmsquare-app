import { describe, expect, it } from "vitest";
import { applyDrag, applyZoom, cameraPosition, wheelZoomFactor, PITCH_MAX, PITCH_MIN } from "./orbit";
import type { OrbitState } from "./orbit";

const s: OrbitState = { yaw: 0.7, pitch: 0.5, dist: 40, minDist: 10, maxDist: 100 };

describe("orbit maths", () => {
  it("dragging rotates and clamps the pitch", () => {
    const a = applyDrag(s, 100, 0);
    expect(a.yaw).toBeCloseTo(0.7 - 0.8, 9);
    expect(applyDrag(s, 0, 1e6).pitch).toBe(PITCH_MAX);
    expect(applyDrag(s, 0, -1e6).pitch).toBe(PITCH_MIN);
  });
  it("zoom is clamped and ignores nonsense", () => {
    expect(applyZoom(s, 0.001).dist).toBe(10);
    expect(applyZoom(s, 1000).dist).toBe(100);
    expect(applyZoom(s, Number.NaN)).toBe(s);
    expect(applyZoom(s, -1)).toBe(s);
    expect(applyZoom(s, 0.5).dist).toBe(20);
  });
  it("a plain wheel is left to the page; Ctrl or Cmd + wheel (and a trackpad pinch) zooms", () => {
    expect(wheelZoomFactor({ deltaY: 100, ctrlKey: false, metaKey: false })).toBeNull();
    expect(wheelZoomFactor({ deltaY: 100, ctrlKey: true, metaKey: false })).toBeCloseTo(1.1, 9);
    expect(wheelZoomFactor({ deltaY: -100, ctrlKey: false, metaKey: true })).toBeCloseTo(0.9, 9);
    expect(wheelZoomFactor({ deltaY: 4, ctrlKey: true, metaKey: false })).toBeCloseTo(1.04, 9);
    expect(wheelZoomFactor({ deltaY: 1e6, ctrlKey: true, metaKey: false })).toBe(1.5);
  });
  it("the camera sits at the orbit distance from its target", () => {
    const t: [number, number, number] = [1, 2, 3];
    const p = cameraPosition(t, s);
    expect(Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])).toBeCloseTo(40, 9);
    expect(p[1]).toBeGreaterThan(t[1]);
  });
});
