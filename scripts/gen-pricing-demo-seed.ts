// Writes scripts/seed-pricing-demo.sql from scripts/pricing-demo-books.ts, the
// same data the golden test (src/lib/pricing/demoSeed.test.ts) prices.
//
//   npx jiti scripts/gen-pricing-demo-seed.ts
//
// Re-run it and commit the SQL whenever the books change; the test fails if
// the committed SQL no longer matches. The SQL is the only thing that runs in
// a database.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderSeedSql } from "./pricing-demo-books";

const out = join(__dirname, "seed-pricing-demo.sql");
writeFileSync(out, renderSeedSql(), "utf8");
console.log(`Wrote ${out}`);
