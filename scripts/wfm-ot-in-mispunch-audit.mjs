/**
 * Audits (and, with --apply, fixes) the "OT in" mis-punch incident: the
 * punch-tile bug fixed in commit 5390d95 (secondary dropdown auto-armed its
 * first option with "Go" clickable) meant an employee meaning to tap
 * "Check in" for a normal day could instead fire an `ot_in` event as the
 * FIRST presence event of their day. A genuine OT punch always follows a
 * `check_out` (OT is its own in/out pair per 0077_wfm_overtime_and_punch_types.sql)
 * -- so "first event of the day is ot_in" is exactly the bug's signature and
 * never a legitimate pattern.
 *
 * Default mode is REPORT ONLY -- it never writes. Pass --apply to actually
 * revert the safe cases (see below). Pass --date=YYYY-MM-DD to audit a day
 * other than today (tenant-local).
 *
 * Run:
 *   node scripts/wfm-ot-in-mispunch-audit.mjs --tenant=bim
 *   node scripts/wfm-ot-in-mispunch-audit.mjs --tenant=bim --apply
 *   node scripts/wfm-ot-in-mispunch-audit.mjs --tenant=bim --date=2026-09-10
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the
 * environment, pointed at PRODUCTION for this to mean anything -- BIM is a
 * production-only tenant. Set both in the shell before running; never paste
 * them into a file in this repo.
 *
 * What --apply does, and does NOT do:
 *   - For an employee with NO correction request filed for the target day
 *     AND no matching ot_out (i.e. the simple case: one stray ot_in, nothing
 *     else touched it) -- inserts a new `check_in` event at the same
 *     timestamp with source='correction', and stamps superseded_by on the
 *     original ot_in event. This mirrors exactly what the corrections
 *     approval route does (api/wfm/corrections/[id]/route.ts) -- append-only,
 *     never an in-place UPDATE of `kind`.
 *   - Anyone who already filed a correction is left alone (that's the normal
 *     supervisor-approval flow's job).
 *   - Anyone whose day also has an ot_out (meaning a wfm_ot_sessions row may
 *     already exist) is left alone and flagged "NEEDS MANUAL REVIEW" -- this
 *     script does not touch wfm_ot_sessions.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment before running this script.");
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const TENANT_SLUG = args.tenant || "bim";
const APPLY = !!args.apply;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  const { data: tenant, error: tErr } = await sb
    .from("tenants")
    .select("id, name, slug, config")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!tenant) throw new Error(`No tenant with slug "${TENANT_SLUG}"`);

  const tz = tenant.config?.wfm?.timezone || "Asia/Kolkata";
  const targetDate = args.date || todayInTz(tz);
  const { startUtc, endUtc } = dayBoundsUtc(targetDate, tz);

  console.log(`Tenant: ${tenant.name} (${tenant.slug})`);
  console.log(`Auditing ${targetDate} (tenant tz ${tz}) — window ${startUtc} .. ${endUtc}`);
  console.log(APPLY ? "Mode: APPLY (will write corrections)" : "Mode: REPORT ONLY (no writes)");
  console.log("");

  const { data: events, error: eErr } = await sb
    .from("wfm_presence_events")
    .select("id, employee_id, ts, kind, superseded_by")
    .eq("tenant_id", tenant.id)
    .gte("ts", startUtc)
    .lt("ts", endUtc)
    .is("superseded_by", null)
    .order("ts", { ascending: true });
  if (eErr) throw eErr;

  // First event of the day per employee.
  const firstByEmployee = new Map();
  const hasOtOutByEmployee = new Set();
  for (const ev of events) {
    if (!firstByEmployee.has(ev.employee_id)) firstByEmployee.set(ev.employee_id, ev);
    if (ev.kind === "ot_out") hasOtOutByEmployee.add(ev.employee_id);
  }

  const misPunched = [...firstByEmployee.values()].filter((ev) => ev.kind === "ot_in");

  if (misPunched.length === 0) {
    console.log("No employees found whose first punch of the day was 'ot_in'. Nothing to do.");
    return;
  }

  const employeeIds = misPunched.map((ev) => ev.employee_id);
  const { data: employees } = await sb
    .from("employees")
    .select("id, first_name, last_name, employee_code")
    .in("id", employeeIds);
  const empById = new Map((employees ?? []).map((e) => [e.id, e]));

  const { data: corrections } = await sb
    .from("wfm_correction_requests")
    .select("id, employee_id, target_date, target_event_id, status")
    .eq("tenant_id", tenant.id)
    .eq("target_date", targetDate)
    .in("employee_id", employeeIds);
  const correctionByEmployee = new Map();
  for (const c of corrections ?? []) {
    if (!correctionByEmployee.has(c.employee_id)) correctionByEmployee.set(c.employee_id, []);
    correctionByEmployee.get(c.employee_id).push(c);
  }

  let noCorrectionSimple = 0;
  let noCorrectionNeedsReview = 0;
  let hasCorrection = 0;

  console.log(`${misPunched.length} employee(s) whose first punch today was OT in:\n`);

  for (const ev of misPunched) {
    const emp = empById.get(ev.employee_id);
    const label = emp ? `${emp.first_name} ${emp.last_name ?? ""} (${emp.employee_code})` : ev.employee_id;
    const filed = correctionByEmployee.get(ev.employee_id) ?? [];
    const otOut = hasOtOutByEmployee.has(ev.employee_id);

    let status;
    if (filed.length > 0) {
      status = `has filed a correction (${filed.map((c) => c.status).join(", ")}) — leaving alone`;
      hasCorrection += 1;
    } else if (otOut) {
      status = "NO correction filed, but also has an ot_out today — NEEDS MANUAL REVIEW (not auto-fixed)";
      noCorrectionNeedsReview += 1;
    } else {
      status = "NO correction filed — safe to revert to check_in";
      noCorrectionSimple += 1;
    }

    console.log(`- ${label}: punch ${ev.id} @ ${ev.ts} — ${status}`);

    if (APPLY && filed.length === 0 && !otOut) {
      const { data: inserted, error: insErr } = await sb
        .from("wfm_presence_events")
        .insert({
          tenant_id: tenant.id,
          employee_id: ev.employee_id,
          ts: ev.ts,
          kind: "check_in",
          source: "correction",
        })
        .select("id")
        .single();
      if (insErr) { console.log(`    FAILED to insert replacement: ${insErr.message}`); continue; }
      const { error: supErr } = await sb
        .from("wfm_presence_events")
        .update({ superseded_by: inserted.id })
        .eq("id", ev.id)
        .eq("tenant_id", tenant.id);
      if (supErr) { console.log(`    FAILED to supersede original: ${supErr.message}`); continue; }
      console.log(`    -> reverted: new check_in event ${inserted.id}, original superseded.`);
    }
  }

  console.log("");
  console.log(`Summary: ${misPunched.length} total, ${hasCorrection} already filed a correction, ` +
    `${noCorrectionSimple} safe-to-revert, ${noCorrectionNeedsReview} need manual review.`);
  if (!APPLY && (noCorrectionSimple > 0)) {
    console.log("Re-run with --apply to revert the safe cases.");
  }
}

function todayInTz(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Local midnight..midnight for dateKey in tz, expressed as UTC ISO bounds.
function dayBoundsUtc(dateKey, tz) {
  // Find the UTC offset for this tz on this date by comparing a known instant's
  // local rendering — avoids a date-library dependency for a one-off script.
  const probe = new Date(`${dateKey}T12:00:00Z`);
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(probe).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const localAsUtc = Date.UTC(+local.year, +local.month - 1, +local.day, +local.hour, +local.minute, +local.second);
  const offsetMs = localAsUtc - probe.getTime();
  const startUtcMs = Date.UTC(...dateKey.split("-").map(Number)) - offsetMs;
  const endUtcMs = startUtcMs + 24 * 3600_000;
  return { startUtc: new Date(startUtcMs).toISOString(), endUtc: new Date(endUtcMs).toISOString() };
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
