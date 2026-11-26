import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/pipeline/new/tender",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import NewTenderForm from "./NewTenderForm";
import { TENDER_TIPS } from "@/lib/tender/tips";
import { tipTextProblems } from "@/lib/infoTip";

const html = (props: Record<string, unknown> = {}) =>
  renderToString(createElement(NewTenderForm, { accounts: [{ id: "a1", name: "Acme" }], contacts: [{ id: "c1", name: "Sara", account_id: "a1" }, { id: "c2", name: "Omar", account_id: "a2" }], ...props } as never)).replace(/<!-- -->/g, "");

describe("the New tender form", () => {
  it("asks for the title, an optional contact and an optional expected value beside the existing fields, each with a guide id", () => {
    const out = html();
    for (const g of ["tender.field.account", "tender.field.title", "tender.field.contact", "tender.field.amount", "tender.field.tender_no", "tender.field.issuer", "tender.field.portal", "tender.field.closing", "tender.field.source"]) {
      expect(out).toContain(`data-guide="${g}"`);
    }
    expect(out).toMatch(/Title/);
    expect(out).toMatch(/Expected value \(INR\)/);
  });

  it("offers no contact until an account is picked (the picker is disabled, and no contact of another account is listed)", () => {
    const out = html();
    expect(out).toContain("Pick the account first");
    expect(out).not.toContain("Sara");
    expect(out).not.toContain("Omar");
  });

  it("sends the title, contact and amount, and the title is required before the request is made", () => {
    const src = readFileSync(path.join(__dirname, "NewTenderForm.tsx"), "utf8");
    expect(src).toContain("title: title.trim()");
    expect(src).toContain("contact_id: form.contact_id || undefined");
    expect(src).toContain("amount: form.amount.trim() ? Number(form.amount) : undefined");
    expect(src).toContain('setError("Give the tender a title")');
  });

  it("keeps its new explanations behind the i and inside the two-sentence limit", () => {
    for (const t of [TENDER_TIPS.title, TENDER_TIPS.contact, TENDER_TIPS.expectedValue, TENDER_TIPS.newTender]) expect(tipTextProblems(t)).toEqual([]);
  });
});
