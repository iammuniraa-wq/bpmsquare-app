import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import StatTile, { StatStrip } from "./StatTile";
import Card from "./Card";
import IconChip from "./IconChip";
import { pillar } from "@/lib/theme";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el);

describe("StatTile", () => {
  it("renders the label, the value and the sub line, tinted by tone, with no coloured top edge", () => {
    const out = html(createElement(StatTile, { label: "Planned margin", value: "24%", sub: "SAR 7,200", tone: "good" }));
    expect(out).toContain("Planned margin");
    expect(out).toContain("24%");
    expect(out).toContain("SAR 7,200");
    expect(out).toContain('data-tone="good"');
    expect(out).toContain(`background:${pillar.teal.bg}`);
    expect(out).not.toContain("border-top:3px");
    expect(out).toContain(`color:${pillar.teal.fg}`);
  });

  it("keeps the plain card surface for neutral, and wraps long text", () => {
    const out = html(createElement(StatTile, { label: "Lines", value: "12" }));
    expect(out).toContain("background:var(--card-bg)");
    expect(out).toContain('data-tone="neutral"');
    expect(out).toContain("overflow-wrap:anywhere");
    expect(out).toContain("font-variant-numeric:tabular-nums");
  });

  it("escapes label, value and sub text", () => {
    const out = html(createElement(StatTile, { label: "<img src=x>", value: "<b>1</b>", sub: "<script>alert(1)</script>", tone: "bad" }));
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;b&gt;1&lt;/b&gt;");
  });

  it("puts the explanation behind an i and never prints it", () => {
    const out = html(createElement(StatTile, { label: "Budget", value: "1", info: "What the work costs." }));
    expect(out).toContain('aria-label="About Budget"');
    expect(out).not.toContain("What the work costs.");
  });
});

describe("StatStrip", () => {
  it("is an auto-fit grid so every strip looks the same, carrying its guide id", () => {
    const out = html(createElement(StatStrip, { guide: "x.strip" }, createElement(StatTile, { label: "A", value: "1" })));
    expect(out).toContain("repeat(auto-fit, minmax(170px, 1fr))");
    expect(out).toContain('data-guide="x.strip"');
  });
});

describe("Card tone", () => {
  it("is exactly the plain card without a tone", () => {
    const plain = html(createElement(Card, { title: "Details" }));
    expect(plain).not.toContain("border-left");
    expect(plain).not.toContain("background:var(--tealbg)");
  });
  it("adds a left edge and a tinted header band with a tone", () => {
    const out = html(createElement(Card, { title: "Needs attention", tone: "warn" }));
    expect(out).toContain(`border-left:3px solid ${pillar.amber.base}`);
    expect(out).toContain(`background:${pillar.amber.bg}`);
    expect(out).toContain("Needs attention");
  });
});

describe("IconChip", () => {
  it("is decorative and tinted", () => {
    const out = html(createElement(IconChip, { tone: "context" }, "x"));
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain(`background:${pillar.purple.bg}`);
  });
});
