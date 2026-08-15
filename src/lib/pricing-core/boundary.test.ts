// CI enforcement of the pricing-core purity boundary (spec §11.3): the core
// must have zero framework/persistence/app-internal imports. The ESLint
// no-restricted-imports block in eslint.config.mjs states the same rule for
// editors, but THIS test is the enforcement that runs in the verified
// pipeline — a violating import fails vitest, not just a lint someone skips.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN = [
  /from\s+["']@supabase\//,
  /from\s+["']next["']/,
  /from\s+["']next\//,
  /from\s+["']react["']/,
  /from\s+["']react-dom["']/,
  /from\s+["']@\/(lib|app|components|extensions)\//,
  /from\s+["']server-only["']/,
  /require\s*\(\s*["']@supabase\//,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("pricing-core boundary (spec §11.3)", () => {
  it("contains no framework, persistence, or app-internal imports", () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(src)) violations.push(`${file}: matches ${pattern}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
