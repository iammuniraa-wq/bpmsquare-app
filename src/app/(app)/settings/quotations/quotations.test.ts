import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { tipTextProblems } from "@/lib/infoTip";
import { DEFAULT_QUOTE_STATUSES, QUOTE_TYPES } from "@/lib/constants";
import type { EmailTemplate, TextFragment } from "@/lib/types";
import {
  addStatus, applySavedEmail, canRemoveStatus, draftFrom, filterTemplates, kindOptions, makeDefaultStatus, moveStatus, nameplateOpen, patchStatus,
  planQuotationsSave, planTemplateSave, placeholders, quotationsDirty, quotationTabs, removeStatus, shownRows, startingText, statusKey, statusProblem,
  templateProblem, templateRows, typeVisibility, withKind, blankTemplate, togglePrintField, EQUIPMENT_FIELDS, NAMEPLATE_FIELDS,
} from "./quotationsLogic";
import { QUOTATION_TIPS } from "./tips";
import StatusesTab from "./StatusesTab";
import OfferTypesTab from "./OfferTypesTab";
import TemplatesTab from "./TemplatesTab";
import PrintTab from "./PrintTab";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const frag = (id: string, label: string, category: TextFragment["category"]): TextFragment => ({ id, label, category, text: `${label} text` });
const mail = (id: string, name: string, category: EmailTemplate["category"], is_default = false): EmailTemplate => ({ id, name, category, subject: "S", body: "B", is_default, created_at: "2026-01-01" });

describe("statuses: one table, the key is made once and never changes", () => {
  it("makes a key from the name and keeps it unique", () => {
    expect(statusKey("PO Received", [])).toBe("po_received");
    expect(statusKey("PO Received", ["po_received"])).toBe("po_received_2");
    expect(statusKey("!!!", [])).toBe("status");
  });

  it("adds an open status before the closed ones, and refuses a blank or repeated name", () => {
    const res = addStatus(DEFAULT_QUOTE_STATUSES, { label: "PO received", color: "#111111" });
    if (!("list" in res)) throw new Error("expected a list");
    expect(res.list.map((s) => s.value)).toEqual(["draft", "sent", "po_received", "approved", "rejected"]);
    expect(addStatus(DEFAULT_QUOTE_STATUSES, { label: "  ", color: "#111111" })).toHaveProperty("error");
    expect(addStatus(DEFAULT_QUOTE_STATUSES, { label: "sent", color: "#111111" })).toHaveProperty("error");
  });

  it("renaming changes the label, not the stored key", () => {
    const next = patchStatus(DEFAULT_QUOTE_STATUSES, "sent", { label: "Dispatched" });
    expect(next[1]).toMatchObject({ value: "sent", label: "Dispatched" });
  });

  it("keeps exactly one default and moves it with Start new quotes here", () => {
    const next = makeDefaultStatus(DEFAULT_QUOTE_STATUSES, "sent");
    expect(next.filter((s) => s.is_initial).map((s) => s.value)).toEqual(["sent"]);
  });

  it("moves a status earlier or later and stops at the ends", () => {
    expect(moveStatus(DEFAULT_QUOTE_STATUSES, "sent", -1).map((s) => s.value).slice(0, 2)).toEqual(["sent", "draft"]);
    expect(moveStatus(DEFAULT_QUOTE_STATUSES, "draft", -1)).toBe(DEFAULT_QUOTE_STATUSES);
    expect(moveStatus(DEFAULT_QUOTE_STATUSES, "rejected", 1)).toBe(DEFAULT_QUOTE_STATUSES);
  });

  it("will not remove the default or the last status", () => {
    const [draft, sent] = DEFAULT_QUOTE_STATUSES;
    expect(canRemoveStatus(DEFAULT_QUOTE_STATUSES, draft)).toBe(false);
    expect(removeStatus(DEFAULT_QUOTE_STATUSES, "draft")).toBe(DEFAULT_QUOTE_STATUSES);
    expect(removeStatus(DEFAULT_QUOTE_STATUSES, "sent").map((s) => s.value)).toEqual(["draft", "approved", "rejected"]);
    expect(canRemoveStatus([sent], sent)).toBe(false);
  });

  it("says what the server would refuse before sending", () => {
    expect(statusProblem(DEFAULT_QUOTE_STATUSES)).toBeNull();
    expect(statusProblem(DEFAULT_QUOTE_STATUSES.map((s) => ({ ...s, is_closed: false })))).toMatch(/closed/);
    expect(statusProblem(DEFAULT_QUOTE_STATUSES.map((s) => ({ ...s, is_initial: false })))).toMatch(/default/);
    expect(statusProblem([{ value: "x", label: " ", color: "#000", is_initial: true, is_closed: true }])).toMatch(/name/);
  });

  it("renders a row per status with its colour dot, and no card, key field or per-row buttons", () => {
    const out = html(createElement(StatusesTab, { statuses: DEFAULT_QUOTE_STATUSES, accent: "#123456", onChange: () => {} }));
    expect((out.match(/<tr/g) ?? []).length).toBe(DEFAULT_QUOTE_STATUSES.length + 1);
    expect(out).toContain("Starts here");
    expect(out).toContain("Closed");
    expect(out).toContain('aria-label="Open Draft"');
    expect(out).not.toContain("Value (key)");
    expect(out).not.toContain("type=\"radio\"");
    expect(out).toContain("+ New status");
    expect(out).toContain("Reset to defaults");
  });
});

describe("offer types: one toggle list", () => {
  it("shows every type unless it was hidden", () => {
    const v = typeVisibility({ budgetary: false });
    expect(v.budgetary).toBe(false);
    expect(v.quotation).toBe(true);
    expect(Object.keys(v)).toEqual(QUOTE_TYPES.map((t) => t.id));
  });

  it("renders a row per type with a switch and marks the unavailable ones", () => {
    const out = html(createElement(OfferTypesTab, { visibility: typeVisibility({}), accent: "#123456", onChange: () => {} }));
    expect((out.match(/role="switch"/g) ?? []).length).toBe(QUOTE_TYPES.length);
    expect(out).toContain("Coming soon");
    expect(out).toContain("Technical Offer");
  });
});

describe("templates: text and email in one table", () => {
  const rows = templateRows(
    [frag("f1", "Copper clause", "notes"), frag("f2", "Rewind", "line_item"), frag("f3", "Payment", "terms")],
    [mail("m1", "Standard", "quote", true), mail("m2", "Supplier ask", "rfq"), mail("m3", "Report mail", "report")],
  );

  it("lists both kinds, text first by kind order, then the emails", () => {
    expect(rows.map((r) => r.name)).toEqual(["Rewind", "Copper clause", "Payment", "Standard", "Supplier ask", "Report mail"]);
    expect(rows.map((r) => r.key)).toContain("email:m1");
    expect(rows.map((r) => r.key)).toContain("text:f1");
  });

  it("filters by the chip", () => {
    expect(filterTemplates(rows, "all")).toHaveLength(6);
    expect(filterTemplates(rows, "notes").map((r) => r.name)).toEqual(["Copper clause"]);
    expect(filterTemplates(rows, "email")).toHaveLength(3);
  });

  it("shows a few rows and then Show all", () => {
    const many = Array.from({ length: 12 }, (_, i) => i);
    expect(shownRows(many, false)).toEqual({ rows: many.slice(0, 8), hidden: 4 });
    expect(shownRows(many, true).hidden).toBe(0);
    expect(shownRows([1, 2], false).hidden).toBe(0);
  });

  it("sends a text template to the text route and an email to the email route", () => {
    expect(planTemplateSave({ ...blankTemplate("notes"), name: " Copper ", body: "x" })).toEqual({ url: "/api/settings/templates", method: "POST", body: { label: "Copper", category: "notes", text: "x" } });
    expect(planTemplateSave({ id: "f1", kind: "terms", name: "P", subject: "", body: "x", isDefault: false })).toMatchObject({ url: "/api/settings/templates/f1", method: "PATCH", body: { category: "terms" } });
    expect(planTemplateSave({ ...blankTemplate("email_rfq"), name: "A", subject: "S", body: "B", isDefault: true })).toEqual({ url: "/api/settings/email-templates", method: "POST", body: { name: "A", subject: "S", body: "B", category: "rfq", is_default: true } });
    expect(planTemplateSave({ id: "m1", kind: "email_quote", name: "A", subject: "S", body: "B", isDefault: false }).body).not.toHaveProperty("is_default");
    expect(planTemplateSave({ id: "m1", kind: "email_quote", name: "A", subject: "S", body: "B", isDefault: true }).body).toMatchObject({ is_default: true });
  });

  it("asks for a subject only on an email, and for a name and text always", () => {
    expect(templateProblem({ ...blankTemplate("notes"), name: "A", body: "x" })).toBeNull();
    expect(templateProblem({ ...blankTemplate("email_quote"), name: "A", body: "x" })).toMatch(/subject/);
    expect(templateProblem({ ...blankTemplate("notes"), name: " ", body: "x" })).toMatch(/name/);
    expect(templateProblem({ ...blankTemplate("notes"), name: "A", body: " " })).toMatch(/empty/);
  });

  it("offers only live kinds for a new template and fixes an email's kind once saved", () => {
    expect(kindOptions(blankTemplate()).map((k) => k.id)).not.toContain("email_report");
    expect(kindOptions({ ...blankTemplate("email_rfq"), id: "m2" }).map((k) => k.id)).toEqual(["email_rfq"]);
    expect(kindOptions({ ...blankTemplate("notes"), id: "f1" }).map((k) => k.id)).toEqual(["line_item", "notes", "terms", "sow"]);
  });

  it("starts an email with its built-in text and swaps it on a kind change, but never over typing", () => {
    const start = { ...blankTemplate("email_quote"), ...startingText("email_quote") };
    expect(start.subject).toContain("{{quote_ref}}");
    expect(withKind(start, "email_rfq").subject).toContain("{{rfq_ref}}");
    expect(withKind({ ...start, body: "my own words" }, "email_rfq").body).toBe("my own words");
    expect(withKind(start, "notes").body).toBe("");
  });

  it("lists the placeholders of an email kind and none for a text", () => {
    expect(placeholders("email_quote")).toContain("{{quote_ref}}");
    expect(placeholders("notes")).toEqual([]);
  });

  it("keeps one default per email kind when a new default is saved", () => {
    const saved = { ...rows.find((r) => r.key === "email:m1")!, key: "email:m9", id: "m9", name: "New", isDefault: true };
    const next = applySavedEmail(rows, saved);
    expect(next.filter((r) => r.kind === "email_quote" && r.isDefault).map((r) => r.id)).toEqual(["m9"]);
  });

  it("renders one table with a Kind column and a chip per kind, and no card per category", () => {
    const out = html(createElement(TemplatesTab, { rows, accent: "#123456", onRows: () => {} }));
    expect((out.match(/<table/g) ?? []).length).toBe(1);
    expect(out).toContain(">Kind<");
    expect(out).toContain("Email: supplier RFQ");
    expect(out).toContain("+ New template");
    for (const chip of ["All", "Line item", "Notes", "Terms", "Scope", "Email"]) expect(out).toContain(`>${chip}</button>`);
    expect(out).not.toContain("Terms &amp; conditions");
  });
});

describe("print: a pick list, nameplate folded", () => {
  it("toggles a field", () => {
    expect(togglePrintField(["name"], "make")).toEqual(["name", "make"]);
    expect(togglePrintField(["name", "make"], "name")).toEqual(["make"]);
  });

  it("opens the nameplate group only when one of its fields is in use", () => {
    expect(nameplateOpen(["name"])).toBe(false);
    expect(nameplateOpen(["duty"])).toBe(true);
  });

  it("renders the equipment fields, the custom ones and the folded nameplate, with no examples printed", () => {
    const out = html(createElement(PrintTab, { fields: ["name"], customFields: [{ value: "cf_year", label: "Year" }], onChange: () => {} }));
    for (const f of [...EQUIPMENT_FIELDS, ...NAMEPLATE_FIELDS]) expect(out).toContain(f.label);
    expect(out).toContain("Year");
    expect(out).toContain("Motor nameplate");
    expect(out).not.toContain("e.g.");
    expect(out).not.toContain("<details open");
  });
});

describe("one draft, one Save for statuses, offer types and print", () => {
  const base = draftFrom(null, null, ["name"]);

  it("is clean until something changes and then sends only that group to the route the old page used", () => {
    expect(quotationsDirty(base, base)).toBe(false);
    expect(planQuotationsSave(base, base)).toEqual([]);
    const steps = planQuotationsSave(base, { ...base, statuses: patchStatus(base.statuses, "sent", { label: "Out" }), print: ["name", "make"] });
    expect(steps.map((s) => [s.id, s.method, s.url])).toEqual([
      ["statuses", "PUT", "/api/settings/quote-statuses"],
      ["print", "PUT", "/api/settings/asset-print-fields"],
    ]);
    const types = planQuotationsSave(base, { ...base, types: { ...base.types, amc: false } });
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ id: "types", method: "PATCH", url: "/api/settings/entities" });
    expect((types[0].body as { quote_type_visibility: Record<string, boolean> }).quote_type_visibility.amc).toBe(false);
  });

  it("starts from the default statuses when the workspace has none of its own", () => {
    expect(base.statuses).toEqual(DEFAULT_QUOTE_STATUSES);
  });
});

describe("which tabs a workspace gets", () => {
  it("gives Quotations the first three, Assets the Print tab, both all four", () => {
    expect(quotationTabs({ quotations: true })).toEqual(["statuses", "types", "templates"]);
    expect(quotationTabs({ assets: true })).toEqual(["print"]);
    expect(quotationTabs({ quotations: true, assets: true })).toEqual(["statuses", "types", "templates", "print"]);
    expect(quotationTabs({ wfm: true })).toEqual([]);
  });
});

describe("the explanations sit behind the i", () => {
  it("every text fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(QUOTATION_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
    for (const t of QUOTE_TYPES) expect(tipTextProblems(t.description), t.id).toEqual([]);
  });
});

describe("PC and 375 px", () => {
  const css = readFileSync(join(process.cwd(), "src/app/(app)/settings/quotations/quotations.module.css"), "utf8");
  it("has 44 px targets on a phone and 36 px swatches on a desktop", () => {
    expect(css).toMatch(/@media \(max-width: 780px\)[\s\S]*\.swatch, \.custom \{ width: 44px; height: 44px/);
    expect(css).toMatch(/@media \(max-width: 780px\)[\s\S]*\.chip \{ min-height: 44px/);
    expect(css).toMatch(/\.fieldChip[^{]*\{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.more > summary \{[^}]*min-height: 44px/);
  });
});
