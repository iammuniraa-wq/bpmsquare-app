import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// "Only Released feeds BOQ, estimate and handover" (docs/design/pcbs-drawing-register.md section 4) is true only while nothing but the register
// reads the elements table. Everything outside it reads through src/lib/drawings/released.ts, which reads the database view that holds the
// elements of RELEASED revisions. This test fails the build the day a file reads the table or the view some other way, so a draft or an in-review
// revision cannot leak into a bill of quantities, an estimate or a handover.

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") sources(p, out); continue; }
    if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

/** The register's OWN files that may name the elements table: its writers and its own routes and pages. Not a feature that consumes elements. */
const TABLE_OWNERS = ["src/lib/drawings/server.ts", "src/lib/drawings/writes.ts", "src/lib/objectFeatureMap.ts"];
const TABLE_OWN_DIRS = ["src/app/api/drawings/", "src/app/(app)/drawings/"];
const VIEW_OWNERS = ["src/lib/drawings/released.ts"];

describe("only released elements leave the register", () => {
  const files = sources(SRC).map((p) => ({ file: rel(p), text: readFileSync(p, "utf8") }));

  it("no file outside the register reads the elements table", () => {
    const offenders = files.filter((f) => /\bdrawing_revision_elements\b/.test(f.text) && !TABLE_OWNERS.includes(f.file) && !TABLE_OWN_DIRS.some((d) => f.file.startsWith(d))).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("nothing but released.ts reads the released-elements view", () => {
    const offenders = files.filter((f) => /\breleased_drawing_elements\b/.test(f.text) && !VIEW_OWNERS.includes(f.file)).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("the BOQ pins and the tender screens take quantities from the one reader", () => {
    const pins = files.find((f) => f.file === "src/lib/drawings/boqPins.ts")!;
    expect(pins.text).toMatch(/loadReleasedElements/);
    expect(pins.text).not.toMatch(/drawing_revision_elements|released_drawing_elements/);
  });

  it("the view holds released revisions only and no member can read it past the row policies", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0256_drawing_elements.sql"), "utf8");
    const view = sql.slice(sql.indexOf("create or replace view released_drawing_elements"));
    expect(view).toMatch(/where r\.status = 'released'/);
    expect(view).toMatch(/revoke all on released_drawing_elements from anon, authenticated/);
    expect(view).toMatch(/grant select on released_drawing_elements to service_role/);
    // joins stay inside one workspace
    expect(view).toMatch(/r\.tenant_id = e\.tenant_id/);
    expect(view).toMatch(/d\.tenant_id = e\.tenant_id/);
  });
});
