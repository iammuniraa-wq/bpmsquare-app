import { FEEDS, REQUIRED_FIELD_KEYS, REV_SCHEMES } from "./types";
import { patternToRegExp } from "./rules";

// A drawing TYPE as a workspace edits it (docs/design/pcbs-drawing-register.md section 1, 3c rule 11). One cleaner for the settings route and
// the tests: it returns exactly the columns that may be written, or the first problem. Approver ids are only checked here for SHAPE; the route
// resolves them against the workspace's own members before they are stored.

export type TypeInput = {
  name: string; numbering_pattern: string | null; rev_scheme: (typeof REV_SCHEMES)[number]; approver_ids: string[]; second_person: boolean;
  required_fields: string[]; feeds: string[]; active: boolean; sort_order: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `partial` = a PATCH: only the keys present are cleaned and returned. */
export function cleanType(body: Record<string, unknown>, partial: boolean): { ok: true; value: Partial<TypeInput> } | { ok: false; error: string } {
  const out: Partial<TypeInput> = {};
  const has = (k: string) => k in body;
  if (!partial || has("name")) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { ok: false, error: "A name is needed" };
    if (name.length > 80) return { ok: false, error: "A name is at most 80 characters" };
    out.name = name;
  }
  if (!partial || has("numbering_pattern")) {
    const p = typeof body.numbering_pattern === "string" ? body.numbering_pattern.trim() : "";
    if (p.length > 120) return { ok: false, error: "A pattern is at most 120 characters" };
    if (p) { try { patternToRegExp(p); } catch { return { ok: false, error: "That numbering pattern cannot be read" }; } }
    out.numbering_pattern = p || null;
  }
  if (!partial || has("rev_scheme")) {
    const s = body.rev_scheme ?? "letters";
    if (!(REV_SCHEMES as readonly unknown[]).includes(s)) return { ok: false, error: "Revisions are lettered (A, B, C) or numbered (0, 1, 2)" };
    out.rev_scheme = s as TypeInput["rev_scheme"];
  }
  if (!partial || has("approver_ids")) {
    const ids = Array.isArray(body.approver_ids) ? body.approver_ids : [];
    if (ids.some((i) => typeof i !== "string" || !UUID.test(i))) return { ok: false, error: "An approver is not valid" };
    if (ids.length > 50) return { ok: false, error: "At most 50 approvers" };
    out.approver_ids = [...new Set(ids as string[])];
  }
  if (!partial || has("second_person")) out.second_person = body.second_person !== false;
  if (!partial || has("required_fields")) {
    const f = Array.isArray(body.required_fields) ? body.required_fields : [];
    if (f.some((x) => !(REQUIRED_FIELD_KEYS as readonly unknown[]).includes(x))) return { ok: false, error: "A required field is not one the register knows" };
    out.required_fields = [...new Set(f as string[])];
  }
  if (!partial || has("feeds")) {
    const f = Array.isArray(body.feeds) ? body.feeds : [];
    if (f.some((x) => !(FEEDS as readonly unknown[]).includes(x))) return { ok: false, error: "A feed must be estimate, boq or handover" };
    out.feeds = [...new Set(f as string[])];
  }
  if (!partial || has("active")) out.active = body.active !== false;
  if (!partial || has("sort_order")) {
    const n = Number(body.sort_order ?? 0);
    out.sort_order = Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.round(n))) : 0;
  }
  return { ok: true, value: out };
}
