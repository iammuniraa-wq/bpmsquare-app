import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import RichAccountsView from "./RichAccountsView";
import type { RichAccountRow, TypeChip } from "@/lib/richAccounts";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;

const row: RichAccountRow = {
  id: "a1", name: "Acme Foods", initials: "AF", mesh: "c", typeLabel: "Direct customer", typeTone: "green",
  href: "/accounts/a1", line: "Pune", chips: [{ key: "contacts", n: 2, label: "2 contacts" }],
  tel: "tel:+912012345678", mail: null, quoteHref: null,
};
const chips: TypeChip[] = [
  { id: "all", label: "All", href: "/accounts", active: true },
  { id: "oem", label: "OEM / Vendor", href: "/accounts?type=oem", active: false },
];
const base = { rows: [row], typeChips: chips, table: createElement("p", null, "STANDARD-TABLE"), pager: createElement("p", null, "PAGER"), total: 1, filtered: false };
const html = (over: object = {}) => renderToString(createElement(RichAccountsView, { ...base, ...over }));

describe("RichAccountsView", () => {
  it("opens on Rows: the whole row links to the record, with the real facts only", () => {
    const out = html();
    expect(out).toContain("rich-rows");
    expect(out).toContain('href="/accounts/a1"');
    expect(out).toContain("Acme Foods");
    expect(out).toContain("Direct customer");
    expect(out).toContain("2 contacts");
    expect(out).toContain("PAGER");
    expect(out).not.toContain("STANDARD-TABLE");
    expect(out).not.toContain("rich-spark");
  });

  it("offers call only where the record has a phone; no e-mail or quote target is drawn without data", () => {
    const out = html();
    expect(out).toContain('href="tel:+912012345678"');
    expect(out).toContain('aria-label="Call Acme Foods"');
    expect(out).not.toContain("mailto:");
    expect(out).not.toContain("New quote for");
  });

  it("has the Rows / Cards / Table switch with Rows selected, and the type chips as links", () => {
    const out = html();
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-checked="true"');
    expect(out).toContain("Cards");
    expect(out).toContain("Table");
    expect(out).toContain('href="/accounts?type=oem"');
    expect(out).toContain('aria-current="true"');
  });

  it("shows how many match only while a filter is active", () => {
    expect(html()).not.toContain("rich-acc__count");
    expect(html({ filtered: true, total: 4 })).toContain("4 matches");
    expect(html({ filtered: true, total: 1 })).toContain("1 match");
  });
});
