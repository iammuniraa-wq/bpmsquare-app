// The Attendance fixtures in the shared evaluation shape (src/lib/crew/types.ts EvalCase). Kept out of leadBridge.ts on purpose: it reads the fixture
// files from disk, which has no place in the production bundle that leadBridge.ts is part of.

import type { EvalCase as LeadEvalCase, EvalTag } from "../../types";
import { addDays } from "../dates";
import { createToolSession } from "../tools";
import { buildCase, readsFromInput } from "./fixtures";
import type { EvalCase } from "./types";

const TAG_MAP: Record<string, EvalTag> = {
  "site-level": "site_level",
  "person-level": "person_level",
  quiet: "quiet",
  trainee: "trainee",
  adversarial: "adversarial",
};

/** Tool results keyed the way the shared harness serves them: tool key -> (args key | "*") -> data. */
export async function toLeadEvalCase(c: EvalCase): Promise<LeadEvalCase> {
  const built = await buildCase(c);
  const siteId = `site-${c.input.site.alias.slice(1).padStart(4, "0")}`;
  const session = createToolSession({
    reads: readsFromInput(c.input),
    run: { siteId, from: c.input.run.from, to: c.input.run.to },
    aliases: built.aliases,
    detect: { sensitivity: c.input.run.sensitivity ?? "balanced" },
  });
  const tool_results: LeadEvalCase["tool_results"] = { attendance_site_digest: { "*": built.digest as unknown as Record<string, unknown> } };
  const flags = await session.call("attendance_punch_flags", {});
  if (flags.ok) tool_results.attendance_punch_flags = { "*": flags.data as Record<string, unknown> };
  const history: Record<string, Record<string, unknown>> = {};
  const aliases = new Set(built.candidates.flatMap((x) => x.members));
  for (const a of aliases) {
    const h = await session.call("attendance_person_history", { alias: a });
    if (h.ok) history[a] = h.data as Record<string, unknown>;
  }
  if (Object.keys(history).length > 0) tool_results.attendance_person_history = history;

  const indexOfCandidate = (kind: string, level: string, subject?: string) =>
    built.candidates.findIndex((x) => x.family === kind && x.level === level && (level === "site" || x.person === subject));

  const tags = new Set<EvalTag>(c.tags.map((t) => TAG_MAP[t]).filter(Boolean));
  if (c.expect.must_flag.length > 0) tags.add("flag_worthy");
  if (/ban|instruction/i.test(c.id)) tags.add("wording");

  return {
    id: c.id,
    tags: [...tags],
    title: c.description,
    today: addDays(c.input.run.to, 1),
    candidates: [c.input.site.alias],
    tool_results,
    expect: {
      must_flag: c.expect.must_flag.map((m) => {
        const i = indexOfCandidate(m.kind, m.level, m.subject);
        return { kind: m.kind, subject: m.level === "site" ? c.input.site.alias : (m.subject as string), must_cite: m.must_cite.map((f) => `s1.candidates[${i}].${f}`) };
      }),
      must_not_flag: c.expect.must_not_flag.map((n) => ({ ...(n.kind ? { kind: n.kind } : {}), ...(n.subject ? { subject: n.subject } : {}), why: n.reason })),
      must_gap: c.expect.must_gap,
      max_findings: c.expect.max_findings,
      proposal_recipients: { forbidden: c.expect.proposals.forbidden_target_aliases },
      nothing_to_report: c.expect.must_flag.length === 0,
    },
  };
}
