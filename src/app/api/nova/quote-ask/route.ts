import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { tenantHasFeature } from "@/lib/tenant";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { compileAndRun } from "@/lib/ai/reportCompile";

/**
 * Nova — Quote Ask. "Maximum intelligence" for the Quotations query bar
 * (owner request 2026-09-01): real AI analysis over the tenant's actual
 * quote data, not just the deterministic token parser (lib/quoteQuery.ts)
 * that handles simple recognised phrases. Deliberately Quotations-only
 * for now, not a generic object-agnostic route -- see NovaQueryBar.tsx's
 * `onAskAI` prop, which only FlowBoardSlot.tsx passes.
 *
 * This is a single-object-locked sibling of /api/reports/ask, reusing
 * the SAME engine (compileAndRun -- see lib/ai/reportCompile.ts) rather
 * than a new one, per this repo's rule against duplicating an AI/query
 * pipeline. It skips reports/ask's routing stage entirely (there is
 * nothing to route -- the object is always "quotations"), so this is one
 * model call instead of two, which matters embedded in a query bar
 * rather than a dedicated "Talk to data" page.
 *
 * `rows` is loaded fresh via LIST_SOURCES.quotations.load(tenantId) --
 * ALL of the tenant's quote data (every touchpoint the object carries:
 * status, value, outcome, quote-to-cash invoiced/paid/balance_due, line
 * counts, account name, ...), not just whatever the Field/Lanes/List
 * view currently has filtered/visible. The question is answered against
 * the real dataset; compileAndRun's own model call derives whatever
 * subset/aggregation the question actually asks for.
 *
 * Gated on the same `ai_reports` flag as Talk to data -- this is the
 * same engine and the same cost/capability, so a tenant that hasn't
 * enabled AI Reports doesn't get it for free via a second door.
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "quotations")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "ai_reports"))) {
    return NextResponse.json({ error: "AI Report Builder isn't enabled for this workspace." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask me something first." }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ error: "That question is too long." }, { status: 400 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Ask AI needs ANTHROPIC_API_KEY set on the server." }, { status: 503 });
  }

  const anthropic = new Anthropic();
  const src = LIST_SOURCES.quotations;
  const rows = await src.load(tenantId);
  const today = new Date().toISOString().slice(0, 10);

  const outcome = await compileAndRun(anthropic, question, "quotations", src, rows, today);
  if (!outcome.ok) {
    return NextResponse.json({ status: "declined", reason: outcome.reason });
  }
  return NextResponse.json(outcome.report);
}
