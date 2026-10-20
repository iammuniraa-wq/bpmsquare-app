import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import InfoTip from "./InfoTip";
import Field from "./Field";
import Card from "./Card";
import OptionGroup from "./OptionGroup";
import { CheckOpt, Opt } from "./Opt";

// Closed-state markup only (the popover and sheet open on interaction, which needs a browser): the "i" is a
// real button named for its label, collapsed, and never nested inside another button.

// createElement's overloads reject a component whose required `children` come as the third argument.
const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el);

describe("InfoTip", () => {
  it("renders one collapsed button named after the label, with the explanation not printed", () => {
    const out = html(createElement(InfoTip, { label: "Topic" }, "Only people who agreed receive it."));
    expect(out).toContain('aria-label="About Topic"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('class="bpm-tip"');
    expect(out).not.toContain("Only people who agreed");
  });
});

describe("Field info", () => {
  it("puts the i after the label, outside the label that names the control", () => {
    const out = html(createElement(Field, { label: "Consent topic", info: "Checked for each person." }, createElement("input", {})));
    expect(out).toContain('aria-label="About Consent topic"');
    expect(out).toMatch(/<label for="[^"]+"><span[^>]*>Consent topic<\/span><\/label><button/);
    expect(out).toMatch(/<input id="fld-[^"]+"/);
    expect(out).not.toContain("Checked for each person.");
  });
  it("keeps the old label for a field without info", () => {
    const out = html(createElement(Field, { label: "Name", hint: "Only your team sees it" }, createElement("input", {})));
    expect(out).not.toContain("bpm-tip");
    expect(out).toContain("Only your team sees it");
  });
});

describe("Card info", () => {
  it("renders the i beside the title, as siblings", () => {
    const out = html(createElement(Card, { title: "Try it", info: "Nothing is sent." }));
    expect(out).toMatch(/<h2[^>]*>Try it<\/h2><button[^>]*aria-label="About Try it"/);
  });
});

describe("OptionGroup and Opt", () => {
  it("makes the header a row whose i is not inside the title button", () => {
    const out = html(createElement(OptionGroup, { id: "g", title: "Blocks", summary: "6 blocks", info: "The pieces.", open: true, onToggle: () => {} }, "body"));
    expect(out).toMatch(/<button type="button" class="bpm-og-title"[^>]*>Blocks<\/button><button[^>]*aria-label="About Blocks"/);
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain("6 blocks");
    expect(out).not.toContain("The pieces.");
  });
  it("a closed group hides its body; the selected phone tab carries the on class", () => {
    const out = html(createElement(OptionGroup, { id: "g", title: "Blocks", open: false, on: true, onToggle: () => {} }, "body"));
    expect(out).toMatch(/class="bpm-og on"/);
    expect(out).toMatch(/id="gBody" hidden/);
  });
  it("Opt shows label, the i and a constraint hint; CheckOpt keeps the i outside the label", () => {
    const o = html(createElement(Opt, { label: "Picture", info: "Kept in your workspace.", hint: "PNG, JPG · max 2 MB", htmlFor: "x" }, createElement("input", { id: "x" })));
    expect(o).toContain("PNG, JPG · max 2 MB");
    expect(o).toContain('aria-label="About Picture"');
    expect(o).not.toContain("Kept in your workspace.");
    const c = html(createElement(CheckOpt, { label: "Use my products", info: "Recent ones.", checked: true, onChange: () => {} }));
    expect(c).toMatch(/<\/label><button[^>]*aria-label="About Use my products"/);
  });
});
