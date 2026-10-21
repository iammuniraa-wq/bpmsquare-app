import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Migration 0200 withdrew the table-level SELECT on tenants from the browser-facing
// roles so tenants.api_key could be hidden (audit 2026-10-21, H3). From then on a
// column added to tenants is unreadable by a session client until it is granted, and
// the failure is a runtime "permission denied", not a build error. This makes it one.

const DIR = path.resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

describe("tenants column grants (migration 0200)", () => {
  it("0200 withdraws the table-level select and never re-grants api_key", () => {
    const sql = readFileSync(path.join(DIR, "0200_tenants_hide_api_key.sql"), "utf8");
    expect(sql).toMatch(/revoke select on public\.tenants from anon, authenticated/);
    expect(sql).toMatch(/column_name <> 'api_key'/);
  });

  it("every later migration that adds a tenants column also grants it", () => {
    const later = files.filter((f) => f.slice(0, 4) > "0200");
    for (const f of later) {
      const sql = readFileSync(path.join(DIR, f), "utf8").replace(/--[^\n]*/g, "");
      const adds = [...sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?tenants\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)].map((m) => m[1]);
      for (const col of adds) {
        if (col === "api_key") continue;
        expect(new RegExp(`grant\\s+select\\s*\\([^)]*\\b${col}\\b[^)]*\\)\\s+on\\s+(?:public\\.)?tenants\\s+to\\s+authenticated`, "i").test(sql), `${f} adds tenants.${col} without "grant select (${col}) on tenants to authenticated"`).toBe(true);
      }
    }
  });
});
