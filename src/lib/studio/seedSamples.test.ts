import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCapabilityCatalog, catalogById } from "@/lib/capability/catalog";
import { sliceForArea } from "@/lib/capability/slice";
import { checkFit } from "./ratings";
import { effortBand } from "./effort";
import facts from "@/lib/capability/facts.generated.json";
import { CHANGE_KINDS, AREA_IDS, PHASES, type AreaId } from "./types";

// The two demo samples (scripts/seed-process-studio-demo.sql) are the first
// thing a prospect sees, so they must obey the rules the app enforces: every
// citation is a real, released catalogue id, offered for that step's area, and
// every rating survives the checker unchanged. A catalogue rename that would
// leave a sample citing a dead id fails here instead of on a demo call.

type Sample = {
  name: string;
  steps: { key: string; area: string; rating: string; caps: string[]; why: string; conf?: string }[];
  changes: { kind: string; band: string; hook?: string; connector?: string; steps: string[] }[];
  tasks: { phase: string; days: number }[];
};

const sql = readFileSync(join(__dirname, "..", "..", "..", "scripts", "seed-process-studio-demo.sql"), "utf8");
const samples: Sample[] = [...sql.matchAll(/\$j\$([\s\S]*?)\$j\$/g)].map((m) => JSON.parse(m[1]) as Sample);
const catalog = getCapabilityCatalog();
const byId = catalogById(catalog);

describe("demo samples", () => {
  it("has the two labelled samples from the mock-up", () => {
    expect(samples.map((s) => s.name)).toEqual(["Al-Khaleej Precast (sample)", "Hosapete Motor Works (sample)"]);
  });

  for (const sample of samples) {
    describe(sample.name, () => {
      it("cites only real, released entries and every rating survives the checker", () => {
        for (const s of sample.steps) {
          expect((AREA_IDS as readonly string[]).includes(s.area), `${s.key} area`).toBe(true);
          const allowed = new Set(sliceForArea(catalog, s.area as AreaId).map((e) => e.id));
          const r = checkFit({ step_id: s.key, rating: s.rating, capability_ids: s.caps, why: s.why, confidence: s.conf ?? "sure" }, byId, allowed);
          expect(r.warnings, `${s.key}: ${r.warnings.join("; ")}`).toEqual([]);
          expect(r.rating, s.key).toBe(s.rating);
        }
      });

      it("uses valid change kinds, bands that follow the rule, and known steps", () => {
        const keys = new Set(sample.steps.map((s) => s.key));
        const known = {
          hooks: new Set((facts.extensionHooks as { name: string }[]).map((h) => h.name)),
          connectors: new Set(["dynamics365", "slack", "gmail", "google_calendar", "mail_server"]),
        };
        for (const c of sample.changes) {
          expect((CHANGE_KINDS as readonly string[]).includes(c.kind)).toBe(true);
          expect(c.band).toBe(effortBand(c.kind as (typeof CHANGE_KINDS)[number], { extensionHook: c.hook ?? null, connector: c.connector ?? null }, known));
          for (const k of c.steps) expect(keys.has(k), k).toBe(true);
        }
      });

      it("plans only in known phases", () => {
        for (const t of sample.tasks) expect((PHASES as readonly string[]).includes(t.phase)).toBe(true);
      });
    });
  }
});
