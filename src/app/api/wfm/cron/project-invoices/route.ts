import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { createProjectInvoice, projectBillingPreview } from "@/lib/wfm/billingServer";
import { previousMonth } from "@/lib/wfm/billing";

// GET /api/wfm/cron/project-invoices — month-end auto-draft. Triggered by
// .github/workflows/wfm-project-invoices.yml on the 1st (NOT a Vercel cron:
// the Hobby plan's two slots are taken, and a third rejects the deploy --
// see wfm-hours-alert.yml).
//
// For every tenant with config.wfm.costing.auto_draft_monthly on: each
// top-level, account-linked, active project with hours last month gets a
// draft invoice for that month, one line per sub-project. Idempotent by
// construction -- the double-billing guard in createProjectInvoice refuses
// a period already covered, so a late or repeated run drafts nothing twice.
// Drafts only: nothing is sent to a customer without a person looking.

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug, features")
    .contains("features", { wfm: true, wfm_projects: true, invoices: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { tenant: string; period: string; drafted: { ref: string; project: string }[]; skipped: { project: string; reason: string }[] }[] = [];

  for (const tenant of tenants ?? []) {
    const tenantId = tenant.id as string;
    const config = await getWfmConfig(admin, tenantId);
    if (!config.costing.auto_draft_monthly) continue;

    const { from, to } = previousMonth(dateKeyInTz(new Date(), config.timezone));
    const { data: projects, error: projErr } = await admin
      .from("wfm_projects")
      .select("id, name, ref")
      .eq("tenant_id", tenantId)
      .is("parent_id", null)
      .not("account_id", "is", null)
      .eq("status", "active");
    if (projErr) {
      results.push({ tenant: tenant.slug as string, period: `${from}..${to}`, drafted: [], skipped: [{ project: "*", reason: projErr.message }] });
      continue;
    }

    const drafted: { ref: string; project: string }[] = [];
    const skipped: { project: string; reason: string }[] = [];
    for (const p of projects ?? []) {
      const label = [p.ref, p.name].filter(Boolean).join(" ");
      const preview = await projectBillingPreview(admin, tenantId, p.id as string, from, to, "sub_project");
      if ("error" in preview) { skipped.push({ project: label, reason: preview.error }); continue; }
      if (preview.lines.length === 0) continue; // nothing worked, nothing to say
      if (preview.blockers.length > 0 || preview.conflicts.length > 0) {
        skipped.push({ project: label, reason: preview.blockers[0] ?? `already billed on ${preview.conflicts[0].invoice_ref}` });
        continue;
      }
      const made = await createProjectInvoice(admin, tenantId, {
        projectId: p.id as string, from, to, granularity: "sub_project", actorId: null, actorEmail: "month-end auto-draft",
      });
      if ("error" in made) skipped.push({ project: label, reason: made.error });
      else drafted.push({ ref: made.ref, project: label });
    }
    if (drafted.length > 0 || skipped.length > 0) {
      results.push({ tenant: tenant.slug as string, period: `${from}..${to}`, drafted, skipped });
    }
  }

  return NextResponse.json({ ok: true, results });
}
