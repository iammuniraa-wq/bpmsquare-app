import "server-only";
import { NextRequest } from "next/server";
import { POST as createRecheckRequest } from "@/app/api/wfm/recheck-requests/route";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { checkEmployeeFacingWording } from "../attendance/wording";
import type { Proposal } from "../types";

// The executor of `wfm.recheck` (docs/design/nova-crew-agents.md section 3.5). It runs on the APPROVER's own session, as their own message: the same door
// as every supervisor action in WFM (requireWfmSupervisor), and then the check the recheck route itself does not make, that each employee is in the
// approver's scope for that day (resolveWfmScope; section 12 item 2). A person outside it is skipped, never asked. The request is then created by the
// route's own handler, in-process, so the e-mail, the notification setting and the record are exactly what a supervisor pressing the button themselves gets.
// The message never mentions an agent (checked again here, on the text the supervisor finally sends).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type RecheckOutcome =
  | { ok: true; result: { requested: number; sent: number; skipped: number } }
  | { ok: false; status: number; error: string; expire?: boolean };

/** Wording the supervisor's final text must pass before anything is claimed or sent. Null = fine. */
export function recheckWordingProblem(message: string): string | null {
  const bad = checkEmployeeFacingWording(message);
  if (bad.length === 0) return null;
  return "Please reword the note: it must read as your own message, with no mention of AI, an agent or a system, and no words about pay or discipline.";
}

export async function executeRecheck(p: Proposal, message: string, opts: { targets?: string[] } = {}): Promise<RecheckOutcome> {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 403, error: err.message ?? "Forbidden" };
  }
  const payload = p.payload as { employee_ids?: unknown; target_date?: unknown };
  const planned = Array.isArray(payload.employee_ids) ? payload.employee_ids.filter((x): x is string => typeof x === "string") : [];
  const date = typeof payload.target_date === "string" && DATE_RE.test(payload.target_date) ? payload.target_date : null;
  if (planned.length === 0 || !date) return { ok: false, status: 422, error: "This note has no one to send to.", expire: true };

  // The supervisor may leave people out, never add anyone.
  const wanted = opts.targets ? planned.filter((id) => opts.targets!.includes(id)) : planned;
  if (wanted.length === 0) return { ok: false, status: 400, error: "Pick at least one person." };

  const scope = await resolveWfmScope(ctx, { from: date, to: date });
  const inScope = wanted.filter((id) => id !== ctx.employee?.id && (scope.unrestricted || (scope.employeeIds ?? []).includes(id)));
  if (inScope.length === 0) return { ok: false, status: 403, error: "None of these people are in your team on that day, so nothing was sent.", expire: true };

  const admin = createAdminSupabase();
  const { data } = await admin.from("employees").select("id").eq("tenant_id", ctx.tenantId).eq("status", "active").in("id", inScope);
  const active = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (active.length === 0) return { ok: false, status: 409, error: "These people are no longer active, so nothing was sent.", expire: true };

  let sent = 0;
  for (const id of active) {
    const res = await createRecheckRequest(new NextRequest("http://internal/api/wfm/recheck-requests", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ employee_id: id, target_date: date, recheck_type: "both", message }),
    }));
    if (res.ok) sent++;
  }
  if (sent === 0) return { ok: false, status: 502, error: "The request could not be created." };
  return { ok: true, result: { requested: wanted.length, sent, skipped: wanted.length - sent } };
}
