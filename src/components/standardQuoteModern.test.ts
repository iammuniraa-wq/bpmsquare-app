import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StandardQuoteModernDocument from "./StandardQuoteModernDocument";
import { defaultStandardQuoteBlocks } from "@/lib/standardQuoteTemplateBlocks";
import { loadExtension } from "@/extensions/registry";

const createElement = create as unknown as (c: unknown, p: object | null) => ReactElement;

const quote = {
  id: "q1", ref: "SQ-2026-0002", status: "draft", valid_until: null, terms: null, notes: null, created_at: "2026-11-27T10:00:00Z",
  header_discount_pct: 0, tax_pct: 15, shipping_amount: 0, intro_text: null, inquiry_date: null, print_options: null,
};
const line = (n: number, d: string, amount: number, extra: object = {}) => ({
  id: `l${n}`, sl_no: String(n), description: d, uom: "lot", qty: 1, rate: amount, amount, is_selected: true, show_on_pdf: true,
  group_id: null, group_label: null, group_type: null, break_of: null, ...extra,
});
const lines = [line(1, "Excavation", 2900), line(2, "Fill and compaction", 6300), line(3, "Disposal of surplus", 2391), line(4, "Overhead", 1159)];

const render = (props: object = {}) => renderToStaticMarkup(createElement(StandardQuoteModernDocument, {
  quote, lines, account: { id: "a1", name: "Harbor Peak Contracting", city: "Dammam" }, contact: { id: "c1", name: "Faisal Al-Dosari" },
  companyInfo: { name: "KAMCO", web: "https://kamcosaudi.com/" }, logoUrl: null, template: null, currency: "SAR", taxLabel: "VAT", ...props,
}));

describe("Standard Quote print, modern layout", () => {
  it("prints the same totals as the quote: subtotal, tax under the workspace's name, and total", () => {
    const html = render();
    for (const text of ["SAR 12,750", "VAT (15%)", "SAR 1,913", "SAR 14,663", "Including VAT 15%", "Harbor Peak Contracting", "Faisal Al-Dosari"]) expect(html).toContain(text);
    expect(html).toContain("kamcosaudi.com");
    expect(html).not.toContain("https://kamcosaudi.com");
  });

  it("never prints a cost, a margin or a validity date nobody set", () => {
    const html = render({ lines: lines.map((l) => ({ ...l, unit_cost: 777.77, margin_pct: 33.3 })) });
    expect(html).not.toMatch(/777\.77|33\.3|Valid until/);
  });

  it("greys an option that was not chosen and leaves it out of the total", () => {
    const options = [
      line(5, "Premium lining", 1000, { group_type: "alternative", group_id: "g1", group_label: "Premium" }),
      line(6, "Standard lining", 500, { group_type: "alternative", group_id: "g2", group_label: "Standard", is_selected: false }),
    ];
    const html = render({ lines: [...lines, ...options] });
    expect(html).toContain("not selected");
    expect(html).toContain("qm-off");
    expect(html).toContain("SAR 13,750");
  });

  it("follows the layout's block switches: hidden totals show no amount card", () => {
    const blocks = defaultStandardQuoteBlocks().map((b) => (b.type === "totals" ? { ...b, visible: false } : b));
    const html = render({ template: { blocks, accent_color: "#112233", logo_position: "left" } });
    expect(html).not.toContain("Quote total");
    expect(html).not.toContain("SAR 14,663");
    expect(html).toContain("--accent:#112233");
  });

  it("ignores a colour that is not a plain hex value", () => {
    expect(render({ brandColor: "red;}body{display:none" })).toContain("--accent:#378ADD");
  });

  it("shows the workspace's defaults on a quote without a template, and lets a template overrule them", () => {
    const defaults = { accent: "#0f9d8a", intro: "Thank you for your enquiry.", signature: true };
    const plain = render({ defaults });
    for (const text of ["--accent:#0f9d8a", "Thank you for your enquiry.", "Authorized Signatory", "Accepted by Harbor Peak Contracting"]) expect(plain).toContain(text);
    const own = render({ defaults, template: { blocks: defaultStandardQuoteBlocks(), accent_color: "#112233", logo_position: "left" } });
    expect(own).toContain("--accent:#112233");
    expect(own).not.toMatch(/Thank you for your enquiry|Authorized Signatory/);
    expect(render({ defaults, quote: { ...quote, intro_text: "Our own words." } })).toContain("Our own words.");
  });

  it("is asked for by KAMCO's extension only", async () => {
    expect((await loadExtension("kamco")).standardQuotePrintStyle?.()).toBe("modern");
    for (const slug of ["vikas", "vikas-pioneers", "demo", "some-other-workspace", null]) {
      expect((await loadExtension(slug)).standardQuotePrintStyle?.() ?? "classic").toBe("classic");
    }
  });
});
