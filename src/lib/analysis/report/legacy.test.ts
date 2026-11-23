import { describe, expect, it } from "vitest";
import { LEGACY_NOTICE, legacyIsEmpty, legacySectionCount, readLegacyReport } from "./legacy";
import { readStoredReport } from "./validate";
import { reportDigest } from "@/lib/assistant/reportTool";

// A report cached before the brief (version 1) stays readable for the seven days it lives: no migration. It is drawn as it is,
// with a line about the format, it is never read as a brief, and a version 2 brief is never read as a version 1 report.

const v1 = () => ({
  v: 1, name: "Najd Precast Co.", domain: "najdprecast.com", country: "Saudi Arabia", summary: "Najd Precast makes precast concrete elements.",
  overview: [{ text: "Najd Precast makes precast concrete elements for housing.", src: 1 }],
  products: [{ text: "Hollow-core slabs", src: 1 }],
  size: [{ text: "about 450 staff", src: 1, on: "2026-03-01" }],
  leadership: [{ name: "Khalid Al-Harbi", title: "Chief Executive Officer", src: 1 }],
  news: [{ text: "Won a SAR 120 m housing package", src: 2, on: "2026-10-18" }],
  projects: [{ text: "Riyadh housing package", src: 2, kind: "award" }],
  strengths: [], weaknesses: [],
  compete: [{ offering: "Precast concrete", text: "Competes directly on housing elements." }],
  sources: [{ n: 1, title: "About", url: "https://najdprecast.com/about" }, { n: 2, title: "News", url: "https://www.arabnews.com/node/9" }],
  leftOut: 2, searches: 6, generatedAt: "2026-10-21T12:00:00.000Z",
});

describe("a cached version 1 report", () => {
  it("is read back as it was, section by section", () => {
    const r = readLegacyReport(v1())!;
    expect(r.v).toBe(1);
    expect(r.overview[0].text).toContain("precast concrete elements");
    expect(r.leadership).toEqual([{ name: "Khalid Al-Harbi", title: "Chief Executive Officer", src: 1 }]);
    expect(legacySectionCount(r, "news")).toBe(1);
    expect(legacyIsEmpty(r)).toBe(false);
    expect(r.searches).toBe(6);
  });

  it("is not a brief: the version 2 reader refuses it, and the version 1 reader refuses a brief", () => {
    expect(readStoredReport(v1())).toBeNull();
    expect(readLegacyReport({ ...v1(), v: 2 })).toBeNull();
    expect(readLegacyReport(null)).toBeNull();
  });

  it("a source that is not https never reaches a link, and the statements that used it go with it", () => {
    const bad = v1();
    bad.sources[0].url = "javascript:alert(1)";
    const r = readLegacyReport(bad)!;
    expect(r.sources.map((s) => s.n)).toEqual([2]);
    expect(r.overview).toEqual([]);
    expect(r.news).toHaveLength(1);
  });

  it("has a digest for the chat that says it is the older format", () => {
    const d = reportDigest(readLegacyReport(v1())!);
    expect(d).toContain("older format");
    expect(d).toContain("Hollow-core slabs");
    expect(d).not.toMatch(/https?:/);
  });

  it("carries one plain line about its format", () => {
    expect(LEGACY_NOTICE).toBe("This is an older report format. Refresh to get the new brief.");
  });
});
