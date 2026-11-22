import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

// Every PDF caller keeps the page options it always had, answers failures the way it always did, and reads only its own
// workspace's document. renderPdf itself is faked here; its own behaviour is in renderPdf.test.ts.

type Spec = {
  source: { kind: "url" | "html"; url?: string; html?: string; cookie?: string; timeoutMs?: number };
  margin: { top: string; right: string; bottom: string; left: string };
  settle: boolean;
  footerAwareBottomMargin?: boolean;
  allowRequest?: (url: string) => boolean;
  onBlocked?: (url: string) => void;
};
const calls: Spec[] = [];
let renderResult: "ok" | "nav" | "boom" = "ok";
let features: Record<string, boolean> = { standard_quotes: true };
let db: ReturnType<typeof fakeDb>;

vi.mock("@/lib/pdf/renderPdf", async () => {
  const real = await vi.importActual<typeof import("@/lib/pdf/renderPdf")>("@/lib/pdf/renderPdf");
  return {
    ...real,
    renderPdf: async (spec: Spec) => {
      calls.push(spec);
      if (renderResult === "nav") throw new real.PdfNavigationError();
      if (renderResult === "boom") throw new Error("boom");
      return Buffer.from("%PDF-test");
    },
  };
});
vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: db.client, tenantId: "t1", userId: "u1", role: "admin" }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true }));
vi.mock("@/lib/data", () => ({ getQuoteByPublicToken: async (id: string) => (id === "q1" ? { quote: { ref: "QT-0001" } } : null) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "acme.example.com" }) }));

const quotePdf = await import("@/app/api/quotes/[id]/pdf/route");
const quotePublic = await import("@/app/api/quotes/[id]/pdf-public/[token]/route");
const standardQuotePdf = await import("@/app/api/standard-quotes/[id]/pdf/route");
const invoicePdf = await import("@/app/api/invoices/[id]/pdf/route");
const { htmlToPdf } = await import("./htmlToPdf");
const { printUrlToPdf } = await import("./printUrlToPdf");
const { signQuotePublicToken } = await import("@/lib/quotePublicLink");

const MARGIN_12 = { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" };
const own = (extra: Row = {}): Row => ({ id: "x1", tenant_id: "t1", ref: "REF-0001", ...extra });
const otherTenants: Row = { id: "x1", tenant_id: "t2", ref: "REF-9999" };
const ctx = { params: Promise.resolve({ id: "x1" }) };
const get = (url: string, cookie = "sb=1") => new NextRequest(url, { headers: cookie ? { cookie } : {} }) as never;
const prevSecret = process.env.QUOTE_PUBLIC_LINK_SECRET;

function seed(tables: Record<string, Row[]>) { db = fakeDb(tables, { copyReads: true }); }
beforeEach(() => {
  calls.length = 0; renderResult = "ok"; features = { standard_quotes: true };
  process.env.QUOTE_PUBLIC_LINK_SECRET = "pdf-test-secret";
  seed({ quotes: [own({ id: "q1" })], standard_quotes: [own()], invoices: [own()], tenants: [{ id: "t1", logo_url: "https://store.test/logo.png", company_info: { logo_url: "https://store.test/co.png" } }] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (prevSecret === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prevSecret;
});

describe("quotation PDF (GET): footer-aware margin, session forwarded", () => {
  it("prints the print page with 12 / measured footer / 15 / 15 mm and the caller's cookie", async () => {
    const res = await quotePdf.GET(get("http://acme.example.com/api/quotes/q1/pdf"), { params: Promise.resolve({ id: "q1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="REF-0001.pdf"');
    expect(calls).toEqual([{ source: { kind: "url", url: "http://acme.example.com/quotations/q1/print", cookie: "sb=1" }, margin: MARGIN_12, settle: true, footerAwareBottomMargin: true }]);
  });

  it("never renders another workspace's quote", async () => {
    seed({ quotes: [otherTenants] });
    const res = await quotePdf.GET(get("http://acme.example.com/api/quotes/x1/pdf"), ctx);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("answers a failed print page with 502 and a failed render with the detail, as before", async () => {
    renderResult = "nav";
    const nav = await quotePdf.GET(get("http://acme.example.com/api/quotes/q1/pdf"), { params: Promise.resolve({ id: "q1" }) });
    expect(nav.status).toBe(502);
    expect(await nav.json()).toEqual({ error: "Failed to render quote for PDF" });
    renderResult = "boom";
    const boom = await quotePdf.GET(get("http://acme.example.com/api/quotes/q1/pdf"), { params: Promise.resolve({ id: "q1" }) });
    expect(boom.status).toBe(500);
    expect(await boom.json()).toEqual({ error: "PDF generation failed: boom" });
  });
});

describe("quotation PDF (POST): the browser's own DOM", () => {
  const html = `<html><head></head><body>${"x".repeat(300)}<script>alert(1)</script></body></html>`;
  const post = (body: unknown) => new NextRequest("http://acme.example.com/api/quotes/q1/pdf", { method: "POST", headers: { cookie: "sb=1" }, body: JSON.stringify(body) }) as never;

  it("prints the posted DOM with scripts stripped and a base tag, the clamped footer margin, and settle", async () => {
    const res = await quotePdf.POST(post({ html, footerMarginMm: 41.4 }), { params: Promise.resolve({ id: "q1" }) });
    expect(res.status).toBe(200);
    const [spec] = calls;
    expect(spec.source.kind).toBe("html");
    expect(spec.source.cookie).toBe("sb=1");
    expect(spec.source.html).toContain('<base href="http://acme.example.com/">');
    expect(spec.source.html).not.toContain("<script");
    expect(spec.margin).toEqual({ top: "12mm", bottom: "41mm", left: "15mm", right: "15mm" });
    expect(spec.settle).toBe(true);
    expect(spec.footerAwareBottomMargin).toBeUndefined();
  });

  it("clamps a tampered footer margin to 20..60 mm and defaults to 30", async () => {
    await quotePdf.POST(post({ html, footerMarginMm: 5000 }), { params: Promise.resolve({ id: "q1" }) });
    await quotePdf.POST(post({ html, footerMarginMm: -3 }), { params: Promise.resolve({ id: "q1" }) });
    await quotePdf.POST(post({ html }), { params: Promise.resolve({ id: "q1" }) });
    expect(calls.map((c) => c.margin.bottom)).toEqual(["60mm", "20mm", "30mm"]);
  });

  it("allows this deployment, data and blob URIs and this workspace's own stored logos; refuses any other host", async () => {
    await quotePdf.POST(post({ html }), { params: Promise.resolve({ id: "q1" }) });
    const allow = calls[0].allowRequest!;
    expect(allow("http://acme.example.com/fonts/DejaVuSans.ttf")).toBe(true);
    expect(allow("data:image/png;base64,AAAA")).toBe(true);
    expect(allow("blob:http://acme.example.com/1")).toBe(true);
    expect(allow("https://store.test/logo.png")).toBe(true);
    expect(allow("https://store.test/co.png")).toBe(true);
    expect(allow("https://store.test/another-tenants-logo.png")).toBe(false);
    expect(allow("https://evil.example.net/a.png")).toBe(false);
    expect(allow("http://169.254.169.254/latest/meta-data")).toBe(false);
    calls[0].onBlocked!("https://evil.example.net/a.png");
    expect(console.error).toHaveBeenCalledWith("quote pdf: blocked https://evil.example.net/a.png");
  });

  it("rejects an empty body before any browser is started, and another workspace's quote", async () => {
    expect((await quotePdf.POST(post({ html: "short" }), { params: Promise.resolve({ id: "q1" }) })).status).toBe(400);
    seed({ quotes: [otherTenants] });
    expect((await quotePdf.POST(post({ html }), ctx)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("answers a failed render with the detail", async () => {
    renderResult = "boom";
    const res = await quotePdf.POST(post({ html }), { params: Promise.resolve({ id: "q1" }) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "PDF generation failed: boom" });
  });
});

describe("quotation PDF, public link", () => {
  it("prints the token-gated page with no cookie and the footer-aware margin", async () => {
    const token = signQuotePublicToken("q1")!;
    const res = await quotePublic.GET(get("http://acme.example.com/x", ""), { params: Promise.resolve({ id: "q1", token }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="QT-0001.pdf"');
    expect(calls).toEqual([{ source: { kind: "url", url: `http://acme.example.com/quotations/q1/print-public/${token}` }, margin: MARGIN_12, settle: true, footerAwareBottomMargin: true }]);
  });

  it("renders nothing for a bad token or an unknown quote", async () => {
    expect((await quotePublic.GET(get("http://acme.example.com/x", ""), { params: Promise.resolve({ id: "q1", token: "nope" }) })).status).toBe(404);
    expect((await quotePublic.GET(get("http://acme.example.com/x", ""), { params: Promise.resolve({ id: "q2", token: signQuotePublicToken("q2")! }) })).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("answers failures as before", async () => {
    const token = signQuotePublicToken("q1")!;
    renderResult = "nav";
    expect((await quotePublic.GET(get("http://acme.example.com/x", ""), { params: Promise.resolve({ id: "q1", token }) })).status).toBe(502);
    renderResult = "boom";
    const res = await quotePublic.GET(get("http://acme.example.com/x", ""), { params: Promise.resolve({ id: "q1", token }) });
    expect(await res.json()).toEqual({ error: "PDF generation failed: boom" });
  });
});

describe("standard quote PDF", () => {
  it("prints its print page with 12 / 12 / 15 / 15 mm, the cookie, and settle", async () => {
    const res = await standardQuotePdf.GET(get("http://acme.example.com/api/standard-quotes/x1/pdf"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="REF-0001.pdf"');
    expect(calls).toEqual([{ source: { kind: "url", url: "http://acme.example.com/standard-quotes/x1/print", cookie: "sb=1" }, margin: MARGIN_12, settle: true }]);
  });

  it("is refused without the module, and never renders another workspace's quote", async () => {
    features = {};
    expect((await standardQuotePdf.GET(get("http://acme.example.com/x"), ctx)).status).toBe(403);
    features = { standard_quotes: true };
    seed({ standard_quotes: [otherTenants] });
    expect((await standardQuotePdf.GET(get("http://acme.example.com/x"), ctx)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("keeps its generic failure message", async () => {
    renderResult = "boom";
    const res = await standardQuotePdf.GET(get("http://acme.example.com/x"), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "PDF generation failed" });
    renderResult = "nav";
    const nav = await standardQuotePdf.GET(get("http://acme.example.com/x"), ctx);
    expect(nav.status).toBe(502);
    expect(await nav.json()).toEqual({ error: "Failed to render quote for PDF" });
  });
});

describe("invoice PDF", () => {
  it("prints its print page with 12 / 12 / 15 / 15 mm, the cookie, and settle", async () => {
    const res = await invoicePdf.GET(get("http://acme.example.com/api/invoices/x1/pdf"), ctx);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ source: { kind: "url", url: "http://acme.example.com/invoices/x1/print", cookie: "sb=1" }, margin: MARGIN_12, settle: true }]);
  });

  it("never renders another workspace's invoice", async () => {
    seed({ invoices: [otherTenants] });
    expect((await invoicePdf.GET(get("http://acme.example.com/x"), ctx)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("answers failures as before", async () => {
    renderResult = "boom";
    const res = await invoicePdf.GET(get("http://acme.example.com/x"), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "PDF generation failed: boom" });
    renderResult = "nav";
    const nav = await invoicePdf.GET(get("http://acme.example.com/x"), ctx);
    expect(nav.status).toBe(502);
    expect(await nav.json()).toEqual({ error: "Failed to render invoice for PDF" });
  });
});

describe("htmlToPdf (RFQ, Process Studio study)", () => {
  it("prints a string with 14 / 14 / 15 / 15 mm, a 20 s timeout, no settle, and only the named storage host", async () => {
    await htmlToPdf("<p>x</p>", { allowHosts: ["store.test"] });
    const [spec] = calls;
    expect(spec.source).toEqual({ kind: "html", html: "<p>x</p>", timeoutMs: 20_000 });
    expect(spec.margin).toEqual({ top: "14mm", bottom: "14mm", left: "15mm", right: "15mm" });
    expect(spec.settle).toBe(false);
    expect(spec.footerAwareBottomMargin).toBeUndefined();
    expect(spec.allowRequest!("https://store.test/logo.png")).toBe(true);
    expect(spec.allowRequest!("data:image/png;base64,AAAA")).toBe(true);
    expect(spec.allowRequest!("https://evil.example.net/logo.png")).toBe(false);
    expect(spec.allowRequest!("http://store.test/logo.png")).toBe(false);
  });

  it("blocks every https host when none is named, and honours a caller timeout", async () => {
    await htmlToPdf("<p>x</p>", { timeoutMs: 5000 });
    expect(calls[0].source.timeoutMs).toBe(5000);
    expect(calls[0].allowRequest!("https://store.test/logo.png")).toBe(false);
  });

  it("lets a failure propagate to its caller", async () => {
    renderResult = "boom";
    await expect(htmlToPdf("<p>x</p>")).rejects.toThrow("boom");
  });
});

describe("printUrlToPdf (sales order PDF and email)", () => {
  it("prints a URL with 12 / 12 / 15 / 15 mm and settle, forwarding the cookie when given", async () => {
    const r = await printUrlToPdf("https://app.test/sales-orders/so1/print", { cookie: "sb=1" });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ source: { kind: "url", url: "https://app.test/sales-orders/so1/print", cookie: "sb=1" }, margin: MARGIN_12, settle: true }]);
  });

  it("reports a failed page as 502 and a failed render as 500, as before", async () => {
    renderResult = "nav";
    expect(await printUrlToPdf("https://app.test/p")).toEqual({ ok: false, status: 502, error: "Failed to render the document for PDF" });
    renderResult = "boom";
    expect(await printUrlToPdf("https://app.test/p")).toEqual({ ok: false, status: 500, error: "PDF generation failed" });
  });
});
