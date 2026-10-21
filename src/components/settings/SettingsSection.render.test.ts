import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import SettingsSection from "./SettingsSection";
import PageHeader from "../PageHeader";

// createElement's overloads reject a component whose required `children` come as the third argument.
const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el);

describe("SettingsSection info", () => {
  it("puts the i after the title as its own button, never inside the header button", () => {
    const out = html(createElement(SettingsSection, { id: "t", title: "Consent topics", info: "People can agree to some and refuse others.", summary: "Offers" }, "body"));
    expect(out).toContain('aria-label="About Consent topics"');
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*><span class="bpm-t-section">Consent topics<\/span><\/button><span[^>]*><button[^>]*aria-label="About Consent topics"/);
    expect(out).not.toContain("People can agree to some");
    expect(out).toContain("Offers");
  });
  it("renders the header exactly as before when there is no info", () => {
    const out = html(createElement(SettingsSection, { id: "t", title: "Plain", summary: "x" }, "body"));
    expect(out).not.toContain("bpm-tip");
    expect(out).toMatch(/<button type="button" aria-expanded="false"[^>]*style="width:100%/);
  });
});

describe("PageHeader info", () => {
  it("puts the i after the title and leaves a header without info unchanged", () => {
    const withInfo = html(createElement(PageHeader, { title: "Consent topics", info: "Every yes and no is kept." }));
    expect(withInfo).toMatch(/<h1[^>]*>Consent topics<\/h1><button[^>]*aria-label="About Consent topics"/);
    const plain = html(createElement(PageHeader, { title: "Consent topics" }));
    expect(plain).not.toContain("bpm-tip");
  });
});
