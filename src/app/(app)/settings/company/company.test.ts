import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { tipTextProblems } from "@/lib/infoTip";
import {
  cleanEntities, companyDirty, companyProblem, companyTabs, draftFrom, planCompanySave, printedName, printsLetterhead, visibleRanges,
} from "./companyLogic";
import { COMPANY_TIPS } from "./tips";
import ProfileTab from "./ProfileTab";
import TaxTab from "./TaxTab";
import NumberingTab from "./NumberingTab";
import EntitiesTab from "./EntitiesTab";
import { DEFAULT_QUOTE_ID_FORMAT } from "@/lib/constants";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const entity = (id: string, name: string, def = false) => ({ id, name, short_name: "", address: "", is_default: def });

describe("one company name", () => {
  it("shows the workspace name and keeps a differing letterhead name apart, in More", () => {
    const same = draftFrom("Acme", { name: "Acme", address: "Road 1" }, {}, "INR");
    expect(same.name).toBe("Acme");
    expect(same.printName).toBe("");
    expect(printedName(same)).toBe("Acme");
    const differs = draftFrom("Acme", { name: "Acme Engineering Pvt Ltd" }, {}, "INR");
    expect(differs.printName).toBe("Acme Engineering Pvt Ltd");
    expect(printedName(differs)).toBe("Acme Engineering Pvt Ltd");
  });

  it("writes the name to the workspace and to the letterhead in one save, and nothing else", () => {
    const initial = draftFrom("Acme", { name: "Acme", address: "Road 1" }, {}, "INR");
    const steps = planCompanySave(initial, { ...initial, name: "Acme Group" });
    expect(steps.map((s) => s.id)).toEqual(["workspace", "company"]);
    expect(steps[0].body).toEqual({ name: "Acme Group" });
    expect(steps[1].body).toMatchObject({ name: "Acme Group", address: "Road 1" });
  });

  it("does not move a letterhead name that was set apart when only the workspace name changes", () => {
    const initial = draftFrom("Acme", { name: "Acme Engineering Pvt Ltd" }, {}, "INR");
    const steps = planCompanySave(initial, { ...initial, name: "Acme Group" });
    expect(steps.map((s) => s.id)).toEqual(["workspace"]);
  });

  it("refuses an empty name", () => {
    const d = draftFrom("Acme", {}, {}, "INR");
    expect(companyProblem({ ...d, name: "  " })).toMatch(/name/);
    expect(companyProblem(d)).toBeNull();
  });
});

describe("one Save over four tabs", () => {
  const base = draftFrom("Acme", { name: "Acme" }, { entities: [entity("e1", "Acme Works", true)], tax: { label: "GST", rate: 18, inclusive: false } }, "INR");

  it("is clean until something changes, and sends only the groups that changed", () => {
    expect(companyDirty(base, base)).toBe(false);
    expect(planCompanySave(base, base)).toEqual([]);
    const steps = planCompanySave(base, { ...base, currency: "QAR", tax: { ...base.tax, rate: 5 }, quoteFormat: { ...DEFAULT_QUOTE_ID_FORMAT, prefix: "Q" } });
    expect(steps.map((s) => s.id)).toEqual(["config", "currency"]);
    expect(steps[0].body).toEqual({ tax: { label: "GST", rate: 5, inclusive: false }, quote_id_format: { ...DEFAULT_QUOTE_ID_FORMAT, prefix: "Q" } });
    expect(steps[1]).toMatchObject({ url: "/api/settings/currency", method: "PUT", body: { code: "QAR" } });
  });

  it("saves the quote ID format through the PATCH that exists (the old Number ranges POST had no handler)", () => {
    const step = planCompanySave(base, { ...base, quoteFormat: { ...base.quoteFormat, seq_digits: 5 } })[0];
    expect(step.method).toBe("PATCH");
    expect(step.url).toBe("/api/settings/entities");
  });

  it("drops an entity that was added and never named, and keeps one default", () => {
    expect(cleanEntities([entity("a", "A"), entity("b", "")]).map((e) => e.id)).toEqual(["a"]);
    expect(cleanEntities([entity("a", "A"), entity("b", "B")]).filter((e) => e.is_default)).toHaveLength(1);
  });

  it("rejects a tax rate outside 0 to 100", () => {
    expect(companyProblem({ ...base, tax: { ...base.tax, rate: 120 } })).toMatch(/rate/);
  });
});

describe("which tabs a workspace gets", () => {
  it("gives a workforce-only workspace Profile and Tax and currency, and numbering only when it has ranges", () => {
    expect(companyTabs({ wfm: true }, false)).toEqual(["profile", "tax"]);
    expect(companyTabs({ business_roles: true }, visibleRanges({ business_roles: true }).length > 0)).toEqual(["profile", "tax", "numbering"]);
  });
  it("adds Entities and Numbering for quotations", () => {
    expect(companyTabs({ quotations: true }, false)).toEqual(["profile", "entities", "tax", "numbering"]);
    expect(printsLetterhead({ invoices: true })).toBe(true);
    expect(printsLetterhead({ wfm: true })).toBe(false);
  });
});

describe("the explanations sit behind the i", () => {
  it("every text fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(COMPANY_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});

describe("Profile tab", () => {
  const props = (over = {}) => ({ draft: draftFrom("Acme", { name: "Acme", address: "Road 1", phones: [{ label: "Work", number: "1" }] }, {}, "INR"), letterhead: true, onName: () => {}, onPrintName: () => {}, onProfile: () => {}, ...over });

  it("asks a workspace that prints nothing for the name alone", () => {
    const out = html(createElement(ProfileTab, props({ letterhead: false })));
    expect(out).toContain("Company name");
    expect(out).not.toContain("Logo");
    expect(out).not.toContain("Address");
  });

  it("has one name and one logo, with the rare letterhead details folded into a single More", () => {
    const out = html(createElement(ProfileTab, props()));
    expect(out.match(/>Company name</g)).toHaveLength(1);
    expect(out.match(/>Logo</g)).toHaveLength(1);
    expect(out.match(/<details/g)).toHaveLength(1);
    expect(out).toContain("More letterhead details");
    // The explanations are behind an i, never printed.
    for (const text of Object.values(COMPANY_TIPS)) expect(out, text).not.toContain(text);
  });

  it("shows the print-name field only when the letterhead already had a different name", () => {
    expect(html(createElement(ProfileTab, props()))).not.toContain("Name on printed documents");
    const differs = draftFrom("Acme", { name: "Acme Pvt Ltd" }, {}, "INR");
    expect(html(createElement(ProfileTab, props({ draft: differs })))).toContain("Name on printed documents");
  });
});

describe("Tax and currency tab", () => {
  const draft = draftFrom("Acme", {}, {}, "QAR");
  const render = (showTax: boolean) => html(createElement(TaxTab, { currency: draft.currency, tax: draft.tax, showTax, accent: "#378ADD", onCurrency: () => {}, onTax: () => {} }));
  it("is one currency control for a workspace that prints nothing", () => {
    const out = render(false);
    expect(out.match(/<select/g)).toHaveLength(1);
    expect(out).not.toContain("Tax label");
  });
  it("is four controls where documents print", () => {
    const out = render(true);
    expect(out.match(/<select/g)).toHaveLength(1);
    expect(out.match(/<input/g)).toHaveLength(2);
    expect(out.match(/role="switch"/g)).toHaveLength(1);
  });
});

describe("Numbering tab", () => {
  it("shows the quote format as four controls and folds the system IDs", () => {
    const out = html(createElement(NumberingTab, { features: { quotations: true, accounts: true }, format: DEFAULT_QUOTE_ID_FORMAT, onFormat: () => {} }));
    expect(out.match(/<input/g)).toHaveLength(3);
    expect(out.match(/<select/g)).toHaveLength(1);
    expect(out).toMatch(/<details/);
    expect(out).toContain("System IDs (1)");
  });
  it("shows only the ranges of modules the workspace has", () => {
    const out = html(createElement(NumberingTab, { features: { cases: true }, format: DEFAULT_QUOTE_ID_FORMAT, onFormat: () => {} }));
    expect(out).toContain("CS-2026-0001");
    expect(out).not.toContain("ACC-0001");
    expect(out).not.toContain("Prefix");
  });
});

describe("Entities tab", () => {
  it("is one row per entity with the default marked, no cards", () => {
    const out = html(createElement(EntitiesTab, { entities: [entity("a", "Acme Works", true), entity("b", "Acme Trading")], onChange: () => {} }));
    expect(out).toContain("Acme Works");
    expect(out).toContain("Acme Trading");
    expect(out.match(/<tr/g)).toHaveLength(3);
    expect(out.match(/>Default</g)).toHaveLength(1);
  });
  it("tells an empty list what quotations use instead", () => {
    expect(html(createElement(EntitiesTab, { entities: [], onChange: () => {} }))).toContain(COMPANY_TIPS.entityBlank);
  });
});
