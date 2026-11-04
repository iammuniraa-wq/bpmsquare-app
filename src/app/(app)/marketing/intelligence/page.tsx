import Link from "next/link";
import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { requireTenantUser } from "@/lib/supabase-server";
import { intelligenceHomeCounts } from "@/lib/marketing/homeCounts";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import OverviewPath, { type PathStep } from "@/components/marketing/OverviewPath";

/**
 * Intelligence Overview (docs/design/marketing-two-parts.md section 6): who is in market, who is ready, where to focus,
 * what worked. A step is drawn only for a module the workspace has and the person may open.
 */
export default async function IntelligenceOverviewPage() {
  let auth;
  try { auth = await requireTenantUser(); } catch { redirect(ROUTES.dashboard); }
  const [tenant, perms] = await Promise.all([getTenant(), resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role)]);
  const f = (tenant?.features ?? {}) as Record<string, boolean | undefined>;
  const can = (feature: string, wc: Parameters<typeof canViewWorkcenter>[1]) => f[feature] === true && canViewWorkcenter(perms, wc);

  const showSignals = can("buying_signals", "signals");
  const showLeads = can("marketing_scoring", "leads");
  const showPlainLeads = !showLeads && can("leads", "leads");
  const showAbm = can("abm", "abm");
  const showResults = can("marketing_attribution", "marketing_attribution");
  if (!showSignals && !showLeads && !showPlainLeads && !showAbm && !showResults) redirect(ROUTES.dashboard);

  const counts = await intelligenceHomeCounts(auth.tenantId, f);
  const n = (v: number | null) => (v === null ? null : String(v));

  const steps: PathStep[] = [];
  if (showSignals) steps.push({ n: steps.length + 1, label: "Who is in market", value: n(counts.inMarket), text: counts.inMarket === null ? "Accounts ranked by how ready they look to buy." : "accounts comparing or deciding.", href: ROUTES.marketingSignals, action: "Buying signals" });
  if (showLeads) steps.push({ n: steps.length + 1, label: "Who is ready", value: n(counts.scoredLeads), text: "scored leads, best first. How points are earned is set in Settings.", href: ROUTES.marketingLeads, action: "Scored leads", tone: counts.scoredLeads ? "warn" : undefined });
  else if (showPlainLeads) steps.push({ n: steps.length + 1, label: "Who is ready", value: null, text: "Leads from forms, enquiries and your team.", href: ROUTES.leads, action: "Leads" });
  if (showAbm) steps.push({ n: steps.length + 1, label: "Where to focus", value: n(counts.abmPrograms), text: counts.abmPrograms === null ? "Work the companies that matter most as a team." : "active programs.", href: ROUTES.marketingAbm, action: "ABM programs" });
  if (showResults) steps.push({ n: steps.length + 1, label: "What worked", value: null, text: "Which emails, forms and events started the deals.", href: ROUTES.marketingAttribution, action: "Results", tone: "good" });

  return (
    <>
      <PageHeader title="Intelligence" subtitle="Know who is ready" info="Scores come from your own quotes, cases, emails and forms. Marketing, next door, is where you reach people." />
      <OverviewPath steps={steps} />
      {showLeads && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <Link href={ROUTES.settingsMarketingLeads} style={{ color: c.accent, fontWeight: 600, minHeight: 44, display: "inline-flex", alignItems: "center" }}>Scoring rules</Link>
        </div>
      )}
    </>
  );
}
