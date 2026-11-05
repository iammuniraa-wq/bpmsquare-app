import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A Vercel cron carries no session, only its CRON_SECRET bearer. If proxy.ts does not let its path through, the job is
// 307'd to /login and silently never runs (hours-alert on 2026-09-04, the crew worker on 2026-11-05).
const root = process.cwd();
const proxy = readFileSync(join(root, "src/proxy.ts"), "utf8");
const crons: { path: string }[] = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).crons ?? [];

function allowed(path: string): boolean {
  const prefixes = [...proxy.matchAll(/pathname\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]);
  const exact = [...proxy.matchAll(/pathname === "([^"]+)"/g)].map((m) => m[1]);
  return exact.includes(path) || prefixes.some((p) => path.startsWith(p));
}

describe("scheduled jobs reach their route", () => {
  it("has crons to check", () => {
    expect(crons.length).toBeGreaterThan(10);
  });

  it.each(crons.map((c) => c.path))("%s is let through the session gate", (path) => {
    expect(allowed(path)).toBe(true);
  });

  it("every cron route checks the secret itself", () => {
    const missing: string[] = [];
    for (const c of crons) {
      const file = join(root, "src/app", c.path, "route.ts");
      let src = "";
      try { src = readFileSync(file, "utf8"); } catch { missing.push(`${c.path} (no route file)`); continue; }
      if (!/cronSecretOk|CRON_SECRET/.test(src)) missing.push(c.path);
    }
    expect(missing).toEqual([]);
  });
});
