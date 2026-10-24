import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { boxFaceExtents, hashSeed, metricBoxGeometry, metricGroundGeometry, metricPlaneGeometry } from "./metricGeometry";
import { hexLuminance, isDarkTheme, skyPalette } from "./skyEnvironment";

describe("metric UVs", () => {
  it("a box face's UVs run over its size in metres", () => {
    const g = metricBoxGeometry(2.4, 3, 0.2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const ext = boxFaceExtents(2.4, 3, 0.2);
    expect(ext[4]).toEqual([2.4, 3]);
    for (let f = 0; f < 6; f++) {
      const us = [0, 1, 2, 3].map((v) => uv.getX(f * 4 + v));
      const vs = [0, 1, 2, 3].map((v) => uv.getY(f * 4 + v));
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(ext[f][0], 6);
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(ext[f][1], 6);
    }
  });

  it("a seed shifts the pattern but not its scale", () => {
    const a = metricBoxGeometry(1, 1, 1, 0).attributes.uv as THREE.BufferAttribute;
    const b = metricBoxGeometry(1, 1, 1, 0.5).attributes.uv as THREE.BufferAttribute;
    expect(b.getX(0) - a.getX(0)).toBeCloseTo(0.5 * 13.7, 6);
    expect(b.getX(1) - b.getX(0)).toBeCloseTo(a.getX(1) - a.getX(0), 6);
  });

  it("seeds are stable, spread and in [0, 1)", () => {
    expect(hashSeed("EW-01")).toBe(hashSeed("EW-01"));
    expect(hashSeed("EW-01")).not.toBe(hashSeed("EW-02"));
    for (const s of ["", "a", "BW-25"]) { const v = hashSeed(s); expect(v >= 0 && v < 1).toBe(true); }
  });

  it("a plane's UV step is the pitch, a ground disc's UVs are its metres", () => {
    const p = metricPlaneGeometry(3, 2, 0.05, 0.05).attributes.uv as THREE.BufferAttribute;
    expect(p.getX(1) - p.getX(0)).toBeCloseTo(60, 6);
    const g = metricGroundGeometry(100);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    let max = 0;
    for (let i = 0; i < uv.count; i++) max = Math.max(max, Math.abs(uv.getX(i)));
    expect(max).toBeCloseTo(100, 3);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeCloseTo(0, 6); // lies flat
  });
});

describe("sky and theme", () => {
  it("tells the dark theme's ground from the light one", () => {
    expect(isDarkTheme("#2d2b27")).toBe(true);
    expect(isDarkTheme("#d6cdbf")).toBe(false);
    expect(isDarkTheme("garbage")).toBe(false);
    expect(hexLuminance("#000000")).toBe(0);
    expect(hexLuminance("#ffffff")).toBeCloseTo(1, 6);
  });

  it("the dark sky is darker than the day sky but still lit enough to read", () => {
    const day = skyPalette(false);
    const night = skyPalette(true);
    expect(hexLuminance(night.horizon)).toBeLessThan(hexLuminance(day.horizon));
    expect(hexLuminance(night.zenith)).toBeLessThan(hexLuminance(day.zenith));
    expect(night.sunLight).toBeLessThan(day.sunLight);
    expect(night.sunLight * night.exposure).toBeGreaterThan(2);
    expect(skyPalette(false)).toBe(day);
  });
});
