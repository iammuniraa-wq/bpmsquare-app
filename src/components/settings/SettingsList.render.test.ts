import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import SettingsList from "./SettingsList";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const noop = () => {};

describe("SettingsList", () => {
  const rows = [
    { key: "a", title: "Lifts", cells: ["LIFTS", "3"] },
    { key: "b", title: "Pumps", cells: ["PUMPS", "0"], dim: true },
  ];

  it("draws one table row per item, the name being the one control that opens it", () => {
    const out = html(createElement(SettingsList, { label: "Categories", headers: ["Code", "Count"], rows, onOpen: noop }));
    expect(out.match(/<tr/g)).toHaveLength(3);
    expect(out.match(/<button/g)).toHaveLength(2);
    expect(out).toContain('aria-label="Open Lifts"');
    expect(out).toContain("LIFTS");
  });

  it("labels each value for the card layout under 780 px", () => {
    const out = html(createElement(SettingsList, { label: "Categories", headers: ["Code", "Count"], rows, onOpen: noop }));
    expect(out).toContain('data-label="Code"');
    expect(out).toContain('data-label="Count"');
  });

  it("says what to do on an empty list instead of drawing an empty table", () => {
    const out = html(createElement(SettingsList, { label: "Categories", rows: [], onOpen: noop, empty: "Nothing yet. Add one." }));
    expect(out).toContain("Nothing yet. Add one.");
    expect(out).not.toContain("<table");
  });
});

describe("the list is one column of cards under 780 px with 44 px targets", () => {
  const css = readFileSync(join(process.cwd(), "src/components/settings/SettingsList.module.css"), "utf8");
  it("turns rows into cards and keeps the open button tall enough to tap", () => {
    expect(css).toMatch(/@media \(max-width: 780px\)[\s\S]*display: block/);
    expect(css).toMatch(/\.open\s*\{[^}]*min-height: 44px/);
  });
});
