import { describe, expect, it } from "vitest";
import { ALLOWED_EXTENSIONS, MAX_FILE_BYTES, extensionOf, filePath, pathBelongsTo, safeFileName, sniffFile, uploadRequestProblem } from "./files";

const bytes = (s: string | number[]) => (typeof s === "string" ? new TextEncoder().encode(s) : new Uint8Array(s));
const T = "11111111-1111-4111-8111-111111111111", D = "22222222-2222-4222-8222-222222222222", R = "33333333-3333-4333-8333-333333333333";

describe("what may be uploaded", () => {
  it("accepts the listed types and never SVG or HTML", () => {
    expect(ALLOWED_EXTENSIONS).toEqual(expect.arrayContaining(["pdf", "dxf", "dwg", "ifc", "xlsx", "csv", "png", "jpg", "rvt"]));
    expect(ALLOWED_EXTENSIONS).not.toContain("svg");
    expect(ALLOWED_EXTENSIONS).not.toContain("html");
    expect(uploadRequestProblem("plan.svg", 100)).toMatch(/SVG and HTML/);
    expect(uploadRequestProblem("page.html", 100)).toMatch(/SVG and HTML/);
    expect(uploadRequestProblem("page.htm", 100)).toMatch(/SVG and HTML/);
    expect(uploadRequestProblem("malware.exe", 100)).toMatch(/not accepted/);
    expect(uploadRequestProblem("plan.pdf", 100)).toBeNull();
  });
  it("checks the size before any bytes move", () => {
    expect(uploadRequestProblem("plan.pdf", 0)).toMatch(/empty/);
    expect(uploadRequestProblem("plan.pdf", MAX_FILE_BYTES + 1)).toMatch(/50 MB/);
    expect(uploadRequestProblem("plan.pdf", MAX_FILE_BYTES)).toBeNull();
    expect(uploadRequestProblem("", 5)).not.toBeNull();
  });
});

describe("the type comes from the bytes, not the name", () => {
  it("recognises real files", () => {
    expect(sniffFile("a.pdf", bytes("%PDF-1.7\n"))).toMatchObject({ ok: true, type: "application/pdf" });
    expect(sniffFile("a.png", bytes([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toMatchObject({ ok: true, inline: true });
    expect(sniffFile("a.jpg", bytes([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ ok: true });
    expect(sniffFile("a.xlsx", bytes([0x50, 0x4b, 0x03, 0x04]))).toMatchObject({ ok: true });
    expect(sniffFile("a.ifc", bytes("ISO-10303-21;\nHEADER;"))).toMatchObject({ ok: true });
    expect(sniffFile("a.dxf", bytes("0\nSECTION\n2\nHEADER\n"))).toMatchObject({ ok: true });
    expect(sniffFile("a.dwg", bytes("AC1027\0\0"))).toMatchObject({ ok: true });
    expect(sniffFile("a.csv", bytes("Mark,Type\nP1,Panel\n"))).toMatchObject({ ok: true });
  });
  it("refuses a file whose content is not what its name says", () => {
    expect(sniffFile("a.pdf", bytes("<html><body>hi</body></html>"))).toMatchObject({ ok: false });
    expect(sniffFile("a.png", bytes("%PDF-1.7"))).toMatchObject({ ok: false });
    expect(sniffFile("a.xlsx", bytes("not a zip"))).toMatchObject({ ok: false });
  });
  it("refuses SVG and HTML even renamed to an allowed type", () => {
    expect(sniffFile("plan.csv", bytes("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toMatchObject({ ok: false, error: expect.stringMatching(/SVG and HTML/) });
    expect(sniffFile("plan.pdf", bytes("<?xml version='1.0'?><svg onload=alert(1)></svg>"))).toMatchObject({ ok: false });
    expect(sniffFile("data.csv", bytes("<!DOCTYPE html><html></html>"))).toMatchObject({ ok: false });
    expect(sniffFile("model.ifc", bytes("<script>alert(1)</script>"))).toMatchObject({ ok: false });
  });
  it("an unknown extension is refused", () => {
    expect(sniffFile("a.svg", bytes("<svg/>"))).toMatchObject({ ok: false });
    expect(sniffFile("noext", bytes("x"))).toMatchObject({ ok: false });
  });
});

describe("names and paths", () => {
  it("a stored name carries no path, control or odd characters", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\plan A.pdf")).toBe("plan A.pdf");
    expect(safeFileName("..hidden")).toBe("hidden");
    expect(safeFileName("a\u0000b<c>.pdf")).toBe("a_b_c_.pdf");
    expect(safeFileName("")).toBe("file");
    expect(extensionOf("Plan.PDF")).toBe("pdf");
    expect(extensionOf("noext")).toBe("");
  });
  it("the path is tenant, drawing, revision, name, and an object elsewhere is never ours", () => {
    const p = filePath(T, D, R, "../x/plan.pdf");
    expect(p).toBe(`${T}/${D}/${R}/plan.pdf`);
    expect(pathBelongsTo(p, T, D, R)).toBe(true);
    expect(pathBelongsTo(p, "other-tenant", D, R)).toBe(false);
    expect(pathBelongsTo(p, T, D, "other-revision")).toBe(false);
    expect(pathBelongsTo(`${T}/${D}/${R}/../../x`, T, D, R)).toBe(false);
  });
});
