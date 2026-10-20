import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { decryptContact } from "@/lib/encryption";
import type { Contact } from "@/lib/types";

// contacts.email_status (0144) is an internal working field for sales: the health of an
// address, set by the delivery webhook and by the check / fix / mark-checked actions. It
// must never come back out through the REST API, MCP, an export, or an import/update file.

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|json)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const mentions = (f: string) => /email_status/.test(readFileSync(f, "utf8"));

describe("contacts.email_status never leaves the server", () => {
  it("decryptContact strips the health columns from every contact it returns", () => {
    const row = { id: "c1", name: "A", email: "plain@x.com", email_status: "bounced", email_status_at: "2026-10-20T00:00:00Z", email_status_reason: "x" } as unknown as Contact;
    const out = decryptContact(row) as unknown as Record<string, unknown>;
    for (const k of ["email_status", "email_status_at", "email_status_reason"]) expect(k in out).toBe(false);
    expect(out.email).toBe("plain@x.com");
  });

  it("no v1 API, export, MCP or API-library file mentions it", () => {
    const surfaces = [
      ...walk(join(ROOT, "src/app/api/v1")),
      ...walk(join(ROOT, "src/app/api/export")),
      ...walk(join(ROOT, "src/lib/api")),
      ...walk(join(ROOT, "mcp-server")),
    ];
    expect(surfaces.filter((f) => !f.endsWith(".test.ts") && mentions(f)).map(rel)).toEqual([]);
  }, 30000);

  it("Data Workbench cannot import or update it: it is on no field registry or import/update spec", () => {
    const places = [
      join(ROOT, "src/lib/fieldRegistry.ts"),
      ...walk(join(ROOT, "src/lib/import")),
      ...walk(join(ROOT, "src/app/api/import")),
      ...walk(join(ROOT, "src/app/api/update")),
    ];
    expect(places.filter((f) => !f.endsWith(".test.ts") && mentions(f)).map(rel)).toEqual([]);
  }, 30000);

  it("only the marketing libraries, the contact health actions and their screens touch the column", () => {
    const ALLOWED = [
      /^src\/lib\/marketing\//,
      /^src\/lib\/encryption\.ts$/,
      /^src\/app\/api\/webhooks\/resend\//,
      /^src\/app\/api\/contacts\/\[id\]\/email-health\//,
      /^src\/app\/\(app\)\/contacts\//,
      // Not contacts: a Process Design Studio study has its own, unrelated email_status (whether its report was sent).
      /^src\/lib\/studio\//,
      /^src\/app\/admin\/studies\//,
      /^src\/app\/api\/process-studio\//,
    ];
    const offenders = walk(join(ROOT, "src"))
      .filter((f) => !f.endsWith(".test.ts"))
      .filter(mentions)
      .map(rel)
      .filter((f) => !ALLOWED.some((re) => re.test(f)));
    expect(offenders).toEqual([]);
  }, 30000);
});
