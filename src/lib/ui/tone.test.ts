import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pillar } from "@/lib/theme";
import { TONES, TONE_PILLAR, toneForBudget, toneForDaysLeft, toneForDelta, toneForMargin, toneForStatus, toneTokens } from "./tone";

describe("tone tokens", () => {
  it("maps every coloured tone to its pillar's own variables and hex base, and neutral to the plain card", () => {
    expect(TONE_PILLAR).toEqual({ info: "blue", good: "teal", warn: "amber", bad: "red", context: "purple" });
    for (const tone of TONES.filter((t) => t !== "neutral")) {
      const p = pillar[TONE_PILLAR[tone as keyof typeof TONE_PILLAR]];
      expect(toneTokens(tone)).toMatchObject({ bg: p.bg, ink: p.fg, edge: p.base });
    }
    expect(toneTokens("neutral").bg).toBe("var(--card-bg)");
    expect(toneTokens().edge).toBe("var(--line)");
  });

  it("uses CSS variables for surface and ink, so a theme or dark mode can remap them", () => {
    for (const tone of TONES) {
      const t = toneTokens(tone);
      expect(t.bg, tone).toMatch(/^var\(--/);
      expect(t.ink, tone).toMatch(/^var\(--/);
    }
  });
});

describe("toneForMargin", () => {
  it("is neutral without a figure, bad below zero, warn under the floor, good from the floor up", () => {
    expect(toneForMargin(null)).toBe("neutral");
    expect(toneForMargin(undefined)).toBe("neutral");
    expect(toneForMargin(Number.NaN)).toBe("neutral");
    expect(toneForMargin(-0.1)).toBe("bad");
    expect(toneForMargin(0)).toBe("warn");
    expect(toneForMargin(9.9)).toBe("warn");
    expect(toneForMargin(10)).toBe("good");
    expect(toneForMargin(24)).toBe("good");
    expect(toneForMargin(14, 15)).toBe("warn");
  });
});

describe("toneForDaysLeft", () => {
  it("is bad when overdue, warn when soon, neutral otherwise or unknown", () => {
    expect(toneForDaysLeft(-1)).toBe("bad");
    expect(toneForDaysLeft(0)).toBe("warn");
    expect(toneForDaysLeft(14)).toBe("warn");
    expect(toneForDaysLeft(15)).toBe("neutral");
    expect(toneForDaysLeft(3, 2)).toBe("neutral");
    expect(toneForDaysLeft(null)).toBe("neutral");
  });
});

describe("toneForDelta", () => {
  it("follows which direction is comfortable", () => {
    expect(toneForDelta(0)).toBe("neutral");
    expect(toneForDelta(null)).toBe("neutral");
    expect(toneForDelta(5)).toBe("good");
    expect(toneForDelta(-5)).toBe("warn");
    expect(toneForDelta(5, "warn")).toBe("warn");
    expect(toneForDelta(-5, "warn")).toBe("good");
  });
});

describe("toneForBudget", () => {
  it("is bad over the limit, warn from 90%, good under, neutral without a limit", () => {
    expect(toneForBudget(101, 100)).toBe("bad");
    expect(toneForBudget(90, 100)).toBe("warn");
    expect(toneForBudget(89, 100)).toBe("good");
    expect(toneForBudget(10, 0)).toBe("neutral");
  });
});

describe("toneForStatus", () => {
  it("reads the word, ignoring case, spaces and hyphens", () => {
    expect(toneForStatus("Won")).toBe("good");
    expect(toneForStatus("approved")).toBe("good");
    expect(toneForStatus("Lost")).toBe("bad");
    expect(toneForStatus("no-bid")).toBe("bad");
    expect(toneForStatus("Baseline pending")).toBe("warn");
    expect(toneForStatus("draft")).toBe("warn");
    expect(toneForStatus("something else")).toBe("neutral");
    expect(toneForStatus(null)).toBe("neutral");
  });
});

describe("no colour literals outside theme.ts", () => {
  const files = ["src/lib/ui/tone.ts", "src/components/ui/StatTile.tsx", "src/components/ui/IconChip.tsx"];
  for (const f of files) {
    it(`${f} holds no hex or rgb colour`, () => {
      const text = readFileSync(path.resolve(__dirname, "../../..", f), "utf8");
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text).not.toMatch(/\brgba?\(/);
    });
  }
});
