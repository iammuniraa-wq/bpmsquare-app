import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { decryptContact } from "@/lib/encryption";
import type { Contact } from "@/lib/types";

// contacts.email_hash is a lookup key for the server. It must never come back
// out through an API, an export, the v1 surface, MCP, or page props.

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

describe("contacts.email_hash never leaves the server", () => {
  it("decryptContact strips it from every contact it returns", () => {
    const row = { id: "c1", name: "A", email: "plain@x.com", email_hash: "deadbeef" } as unknown as Contact;
    const out = decryptContact(row) as unknown as Record<string, unknown>;
    expect("email_hash" in out).toBe(false);
    expect(out.email).toBe("plain@x.com");
  });

  it("no v1 API, export, MCP or API-library file mentions it", () => {
    const surfaces = [
      ...walk(join(ROOT, "src/app/api/v1")),
      ...walk(join(ROOT, "src/app/api/export")),
      ...walk(join(ROOT, "src/lib/api")),
      ...walk(join(ROOT, "mcp-server")),
    ];
    const offenders = surfaces.filter((f) => !f.endsWith(".test.ts") && readFileSync(f, "utf8").includes("email_hash")).map(rel);
    expect(offenders).toEqual([]);
  }, 30000);

  it("only the marketing libraries, the contact write paths and the migrations touch the column", () => {
    const ALLOWED = [
      /^src\/lib\/marketing\//,
      /^src\/lib\/events\//,
      /^src\/lib\/encryption\.ts$/,
      /^src\/lib\/connectors\/d365\/server\.ts$/, // calls stampContactEmailHash only
      /^src\/app\/api\/(contacts|update\/contacts|import\/contacts)\//,
      /^src\/app\/api\/events\//,
    ];
    const offenders = walk(join(ROOT, "src"))
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => readFileSync(f, "utf8").includes("email_hash"))
      .map(rel)
      .filter((f) => !ALLOWED.some((re) => re.test(f)));
    expect(offenders).toEqual([]);
  }, 30000);
});
