import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Rich look of the assistant slider is a stylesheet, so its safety is a contract: it can only ever match inside the
// wrapper Shell stamps for a Rich workspace, and it carries no colour of its own.
const css = readFileSync(join(__dirname, "rich-ai.css"), "utf8");
const dock = readFileSync(join(__dirname, "..", "components", "AIDock.tsx"), "utf8");
const body = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("rich-ai.css", () => {
  it("scopes every rule under [data-rich], so other workspaces are untouched", () => {
    const selectors: string[] = [];
    // Strip @keyframes bodies (their from/to are not selectors), then read each rule's prelude.
    const flat = body.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    for (const m of flat.matchAll(/([^{}]+)\{/g)) selectors.push(m[1].trim());
    const rules = selectors.filter((s) => s && !s.startsWith("@") && !/^(from|to|\d+%)/.test(s));
    expect(rules.length).toBeGreaterThan(40);
    for (const sel of rules) for (const part of sel.split(",")) expect(part.trim(), sel).toMatch(/^\[data-rich="true"\]/);
  });

  it("holds no hex colour (tokens live in rich.css)", () => {
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("stops its motion under prefers-reduced-motion", () => {
    expect(body).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  });

  it("turns the panel into a bottom sheet below 900px and clears the tab bar below 781px", () => {
    expect(body).toMatch(/@media \(max-width: 899px\)[\s\S]*\.bms-dock-panel::before/);
    expect(body).toMatch(/@media \(max-width: 780px\)[\s\S]*\.bms-dock-panel \{ bottom: calc\(88px/);
  });
});

describe("AIDock class hooks", () => {
  it("carries every hook the stylesheet uses", () => {
    for (const hook of ["bms-dock-orb", "bms-dock-switch", "bms-dock-head", "bms-dock-title", "bms-dock-sub", "bms-dock-body", "bms-dock-bubble", "bms-dock-typing", "bms-dock-dots", "bms-dock-field", "bms-dock-send", "bms-dock-input"]) {
      expect(dock, hook).toContain(hook);
    }
  });

  it("hides the Rich-only pieces by default, so a workspace without Rich renders as before", () => {
    expect(dock).toMatch(/\.bms-dock-sub, \.bms-dock-dots \{ display: none; \}/);
  });
});
