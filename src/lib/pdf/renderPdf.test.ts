import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// renderPdf with the browser faked: what it launches, what it lets the page load, what it passes to page.pdf().

type Handler = (req: { url: () => string; continue: () => void; abort: () => void }) => void;
const log: { page: string[]; launched: unknown[]; pdfOptions: unknown[]; closed: number; pagesOpened: number } = { page: [], launched: [], pdfOptions: [], closed: 0, pagesOpened: 0 };
let navOk = true;
let launchError: Error | null = null;
let published: number | null = 34;
let handler: Handler | null = null;

function fakePage() {
  log.pagesOpened++;
  return {
    setRequestInterception: async (on: boolean) => { log.page.push(`intercept:${on}`); },
    on: (_e: string, h: Handler) => { handler = h; },
    setExtraHTTPHeaders: async (h: unknown) => { log.page.push(`headers:${JSON.stringify(h)}`); },
    goto: async (url: string, o: unknown) => { log.page.push(`goto:${url}:${JSON.stringify(o)}`); return { ok: () => navOk }; },
    setContent: async (html: string, o: unknown) => { log.page.push(`setContent:${html.length}:${JSON.stringify(o)}`); },
    evaluate: async () => { log.page.push("evaluate"); return published; },
    waitForFunction: async () => { log.page.push("waitForFunction"); },
    pdf: async (o: unknown) => { log.page.push("pdf"); log.pdfOptions.push(o); return new Uint8Array([37, 80, 68, 70]); },
  };
}
const fakeBrowser = () => ({ newPage: async () => fakePage(), close: async () => { log.closed++; } });
const launch = async (o: unknown) => { log.launched.push(o); if (launchError) throw launchError; return fakeBrowser(); };

vi.mock("puppeteer", () => ({ launch: (o: unknown) => launch(o) }));
vi.mock("puppeteer-core", () => ({ launch: (o: unknown) => launch({ core: true, ...(o as object) }), defaultArgs: async (o: { args: string[] }) => ["--default", ...o.args] }));
vi.mock("@sparticuz/chromium", () => ({ default: { args: ["--sparticuz"], executablePath: async () => "/tmp/chromium" } }));

const { renderPdf, allowHostsRule, PdfNavigationError } = await import("./renderPdf");

const margin = { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" };
const request = (url: string) => {
  const r = { url: () => url, continue: vi.fn(), abort: vi.fn() };
  handler!(r);
  return r;
};

beforeEach(() => {
  log.page = []; log.launched = []; log.pdfOptions = []; log.closed = 0; log.pagesOpened = 0;
  navOk = true; launchError = null; published = 34; handler = null;
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("renderPdf: one document, the options the callers always used", () => {
  it("opens one page and prints one PDF per call, A4 with background printing and no header or footer", async () => {
    const pdf = await renderPdf({ source: { kind: "url", url: "https://app.test/x/print" }, margin, settle: true });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(log.pagesOpened).toBe(1);
    expect(log.pdfOptions).toEqual([{ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" }, displayHeaderFooter: false }]);
    expect(log.closed).toBe(1);
  });

  it("navigates with networkidle0 for a URL and forwards the session cookie only when there is one", async () => {
    await renderPdf({ source: { kind: "url", url: "https://app.test/a", cookie: "sb=1" }, margin, settle: false });
    expect(log.page).toContain('headers:{"cookie":"sb=1"}');
    expect(log.page).toContain('goto:https://app.test/a:{"waitUntil":"networkidle0"}');
    log.page = [];
    await renderPdf({ source: { kind: "url", url: "https://app.test/b", cookie: "" }, margin, settle: false });
    expect(log.page.some((l) => l.startsWith("headers:"))).toBe(false);
    expect(log.page.includes("intercept:true")).toBe(false);
  });

  it("sets HTML with the load event, the caller's timeout only when given", async () => {
    await renderPdf({ source: { kind: "html", html: "<p>x</p>", timeoutMs: 20_000 }, margin, settle: false });
    expect(log.page.find((l) => l.startsWith("setContent"))).toBe('setContent:8:{"waitUntil":"load","timeout":20000}');
    log.page = [];
    await renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: false });
    expect(log.page.find((l) => l.startsWith("setContent"))).toBe('setContent:8:{"waitUntil":"load"}');
  });

  it("settles fonts and images only when asked", async () => {
    await renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: false });
    expect(log.page.filter((l) => l === "evaluate")).toHaveLength(0);
    log.page = [];
    await renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: true });
    expect(log.page.filter((l) => l === "evaluate")).toHaveLength(2);
  });

  it("uses the footer band the print page published as the bottom margin, and nothing else", async () => {
    await renderPdf({ source: { kind: "url", url: "https://app.test/q" }, margin, settle: true, footerAwareBottomMargin: true });
    expect(log.page).toContain("waitForFunction");
    expect(log.pdfOptions[0]).toMatchObject({ margin: { top: "12mm", bottom: "34mm", left: "15mm", right: "15mm" } });
  });

  it("does not look for a footer band unless asked", async () => {
    await renderPdf({ source: { kind: "url", url: "https://app.test/q" }, margin, settle: true });
    expect(log.page).not.toContain("waitForFunction");
    expect(log.pdfOptions[0]).toMatchObject({ margin: { bottom: "12mm" } });
  });
});

describe("renderPdf: what the page may load", () => {
  it("lets a string document load data: URIs and https from the named storage host only", async () => {
    await renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: false, allowRequest: allowHostsRule(["Storage.Example.com"]) });
    expect(log.page).toContain("intercept:true");
    expect(request("data:image/png;base64,AAAA").continue).toHaveBeenCalled();
    expect(request("https://storage.example.com/logos/a.png").continue).toHaveBeenCalled();
    const foreign = request("https://evil.example.net/a.png");
    expect(foreign.abort).toHaveBeenCalled();
    expect(foreign.continue).not.toHaveBeenCalled();
    expect(request("http://storage.example.com/a.png").abort).toHaveBeenCalled();
    expect(request("http://169.254.169.254/latest/meta-data").abort).toHaveBeenCalled();
    expect(request("file:///etc/passwd").abort).toHaveBeenCalled();
  });

  it("blocks every network request of a string document when no rule is given (data: only)", async () => {
    await renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: false });
    expect(request("data:text/plain,a").continue).toHaveBeenCalled();
    expect(request("https://storage.example.com/a.png").abort).toHaveBeenCalled();
  });

  it("passes aborted URLs to onBlocked so a vanished logo leaves a trace", async () => {
    const blocked: string[] = [];
    await renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: false, allowRequest: (u) => u.startsWith("data:"), onBlocked: (u) => blocked.push(u) });
    request("https://evil.example.net/a.png");
    expect(blocked).toEqual(["https://evil.example.net/a.png"]);
  });

  it("does not intercept a print page it navigates to unless a rule is given", async () => {
    await renderPdf({ source: { kind: "url", url: "https://app.test/p" }, margin, settle: false });
    expect(log.page).not.toContain("intercept:true");
  });
});

describe("renderPdf: failures", () => {
  it("throws PdfNavigationError when the print page answers with an error, and still closes the browser", async () => {
    navOk = false;
    await expect(renderPdf({ source: { kind: "url", url: "https://app.test/p" }, margin, settle: true })).rejects.toBeInstanceOf(PdfNavigationError);
    expect(log.closed).toBe(1);
    expect(log.pdfOptions).toHaveLength(0);
  });

  it("passes a failing launch up unchanged, so each route can answer as it always did", async () => {
    launchError = new Error("Could not find Chrome");
    await expect(renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: false })).rejects.toThrow("Could not find Chrome");
    expect(log.closed).toBe(0);
  });
});

describe("renderPdf: which Chromium", () => {
  it("launches full puppeteer in the headless shell mode locally", async () => {
    await renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: false });
    expect(log.launched).toEqual([{ headless: "shell" }]);
  });

  it("launches the Sparticuz build through puppeteer-core in production and on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    await renderPdf({ source: { kind: "html", html: "<p>x</p>" }, margin, settle: false });
    expect(log.launched).toEqual([{ core: true, args: ["--default", "--sparticuz"], executablePath: "/tmp/chromium", headless: "shell" }]);
  });
});
