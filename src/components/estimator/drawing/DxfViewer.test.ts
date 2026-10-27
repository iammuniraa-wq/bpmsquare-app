import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DxfViewer from "./DxfViewer";
import { buildDrawn, entityPath, fitView, layerStroke, panBy, viewBoxOf, zoomAt, zoomLimits } from "./viewerGeometry";
import { parseDxf } from "@/lib/estimator/drawing/dxf";
import type { DxfModel } from "@/lib/estimator/drawing/model";
import { arc, circle, dxfFile, insert, line, lwpoly, rectLines, text } from "@/lib/estimator/drawing/testing/dxfFixtures";

const model = (entities: string[], extra: { blocks?: Record<string, string[]>; layers?: { name: string; colorIndex?: number; frozen?: boolean }[] } = {}): DxfModel => {
  const r = parseDxf(dxfFile({ units: 6, entities, ...extra }));
  if (!r.ok) throw new Error(r.error);
  return r.model;
};
const html = (m: DxfModel, props: Record<string, unknown> = {}) => renderToString(createElement(DxfViewer, { model: m, ...props })).replace(/<!-- -->/g, "");

describe("fit and view maths", () => {
  const ext = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
  it("fits the extents with a margin, in flipped (screen) y, to the canvas aspect", () => {
    const v = fitView(ext, 2);
    expect(v.w / v.h).toBeCloseTo(2, 9);
    expect(v.x).toBeLessThan(0);
    expect(v.x + v.w).toBeGreaterThan(100);
    expect(v.y).toBeLessThan(-50);
    expect(v.y + v.h).toBeGreaterThan(0);
    const tall = fitView(ext, 0.5);
    expect(tall.w / tall.h).toBeCloseTo(0.5, 9);
    expect(tall.w).toBeGreaterThan(100);
  });
  it("an empty drawing still gets a view, and a bad aspect does not break it", () => {
    expect(fitView(null, 1.6).w).toBeGreaterThan(0);
    expect(Number.isFinite(fitView(ext, Number.NaN).w)).toBe(true);
    expect(Number.isFinite(fitView({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 1).w)).toBe(true);
  });
  it("zooms about a point and keeps it still, within limits", () => {
    const v = fitView(ext, 2);
    const z = zoomAt(v, 2, 0.25, 0.75);
    expect(z.w).toBeCloseTo(v.w / 2, 9);
    expect(z.x + z.w * 0.25).toBeCloseTo(v.x + v.w * 0.25, 9);
    expect(z.y + z.h * 0.75).toBeCloseTo(v.y + v.h * 0.75, 9);
    const lim = zoomLimits(v);
    expect(zoomAt(v, 1e9, 0.5, 0.5, lim).w).toBeCloseTo(lim.minW, 9);
    expect(zoomAt(v, 1e-9, 0.5, 0.5, lim).w).toBeCloseTo(lim.maxW, 9);
    expect(zoomAt(v, 0)).toBe(v);
  });
  it("pans by fractions of the view", () => {
    const v = { x: 0, y: 0, w: 10, h: 4 };
    expect(panBy(v, 0.5, -0.25)).toEqual({ x: 5, y: -1, w: 10, h: 4 });
    expect(viewBoxOf(v)).toBe("0 0 10 4");
  });
  it("draws black and white layers in the theme's ink, other colours as they are", () => {
    expect(layerStroke("#ffffff")).toBe("var(--ink)");
    expect(layerStroke("#000000")).toBe("var(--ink)");
    expect(layerStroke("#ff0000")).toBe("#ff0000");
    expect(layerStroke("nonsense")).toBe("var(--ink)");
  });
});

describe("drawing the model", () => {
  it("makes one path per layer with y flipped", () => {
    const d = buildDrawn(model([line("A", 0, 0, 10, 5), lwpoly("B", [[0, 0], [4, 0], [4, 3]], true), circle("C", 1, 1, 2), arc("C", 0, 0, 5, 0, 90)]));
    expect(Object.keys(d.paths).sort()).toEqual(["A", "B", "C"]);
    expect(d.paths.A).toBe("M0 0L10 -5");
    expect(d.paths.B).toBe("M0 0L4 0L4 -3Z");
    expect(d.paths.C).toContain("A");
    expect(d.drawn).toBe(4);
    expect(d.capped).toBe(false);
  });
  it("draws the contents of an inserted block at its position, scale and rotation, on the insert's layer for layer 0", () => {
    const m = model([insert("GATES", "GATE", 10, 20, { sx: 2, rot: 90 })], { blocks: { GATE: [line("0", 0, 0, 1, 0)] } });
    const d = buildDrawn(m);
    expect(Object.keys(d.paths)).toEqual(["GATES"]);
    // (1,0) scaled by 2 and turned 90 degrees is (0,2); placed at (10,20) and flipped: y = -22.
    expect(d.paths.GATES).toBe("M10 -20L10 -22");
  });
  it("marks an insert whose block is not in the file instead of dropping it", () => {
    const d = buildDrawn(model([insert("X", "MISSING", 3, 3)]));
    expect(d.paths.X).toMatch(/^M2\.5 -3L3\.5 -3/);
  });
  it("collects text, and stops at the cap while still counting everything", () => {
    const m = model([text("T", 1, 2, 3, "North"), ...Array.from({ length: 30 }, (_, i) => line("L", i, 0, i, 1))]);
    const d = buildDrawn(m, 10);
    expect(d.texts).toEqual([{ x: 1, y: -2, text: "North", h: 3, layer: "T" }]);
    expect(d.drawn).toBe(10);
    expect(d.total).toBe(31);
    expect(d.capped).toBe(true);
  });
  it("does not loop forever on a block that inserts itself", () => {
    const m = model([insert("A", "LOOP", 0, 0)], { blocks: { LOOP: [insert("0", "LOOP", 1, 1), line("0", 0, 0, 1, 1)] } });
    expect(buildDrawn(m).drawn).toBeLessThan(20);
  });
  it("a full circle is two arcs and an arc is one", () => {
    expect(entityPath({ t: "circle", layer: "C", c: [0, 0], r: 1 }).match(/A/g)).toHaveLength(2);
    expect(entityPath({ t: "arc", layer: "C", c: [0, 0], r: 1, a0: 0, a1: 90 }).match(/A/g)).toHaveLength(1);
  });
});

describe("the viewer renders", () => {
  const m = model([...rectLines("FENCE", 10, 5), insert("GATES", "GATE", 1, 1), text("NOTES", 1, 1, 0.3, "Gate A")], {
    layers: [{ name: "FENCE", colorIndex: 1 }, { name: "GATES", colorIndex: 3 }, { name: "NOTES", frozen: true }], blocks: { GATE: [line("0", 0, 0, 2, 0)] },
  });

  it("has the picture, the zoom buttons at 44px, a keyboard-reachable stage and the layer list", () => {
    const out = html(m);
    expect(out).toContain('role="group"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('aria-label="Zoom in"');
    expect(out).toContain('aria-label="Zoom out"');
    expect(out).toContain('aria-label="Fit the whole drawing"');
    expect(out).toContain('aria-label="Show layer FENCE"');
    expect(out).toContain('vector-effect="non-scaling-stroke"');
    expect(out).toContain('viewBox="');
    expect(out).toContain('data-guide="estimate.drawing-viewer"');
  });
  it("starts with the drawing's own hidden layers off and the others on", () => {
    const out = html(m);
    const box = (layer: string) => (out.match(new RegExp(`<input[^>]*aria-label="Show layer ${layer}"[^>]*>`)) ?? [""])[0];
    expect(box("FENCE")).toContain("checked");
    expect(box("GATES")).toContain("checked");
    expect(box("NOTES")).not.toContain("checked");
    expect(out).not.toContain("Gate A");
  });
  it("draws highlighted layers bold in the accent colour and fades the rest", () => {
    const out = html(m, { highlightLayers: ["fence"] });
    expect(out).toContain('stroke="var(--accent)"');
    expect(out).toContain('stroke-width="3"');
    expect(out).toContain('opacity="0.3"');
    const plain = html(m);
    expect(plain).not.toContain('stroke="var(--accent)"');
    expect(plain).not.toContain('opacity="0.3"');
  });
  it("draws highlighted entities by index", () => {
    expect(html(m, { highlightIds: [0] })).toContain('stroke-width="3.5"');
  });
  it("says when the picture was thinned", () => {
    expect(html(m, { note: "Text is not shown." })).toContain("Text is not shown.");
  });
});
