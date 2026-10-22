import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ACCOUNT_TYPE_LABEL,
  CASE_STATUS_LABEL,
  CASE_TYPE_LABEL,
  estimatesForAccount,
} from "@/lib/data";
import { getAccountHubLive } from "@/lib/data/live";
import { getUserRole, getTenant } from "@/lib/tenant";
import type { Activity, Account, InvoiceStatus } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import QuoteStatusPill from "@/components/QuoteStatusPill";
import { ROUTES, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef, type TenantFeatures } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import ObjectSections from "@/components/fields/ObjectSections";
import QuickCreateDeck from "@/components/QuickCreateDeck";
import { Gear, Activity as ActivityIcon, Package, FileText, Phone } from "@/components/Icons";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import type { RecordAction } from "@/components/page/recordActions";
import RecordActivity from "@/components/page/RecordActivity";
import RelatedList from "@/components/page/RelatedList";
import { projectHoursReport } from "@/lib/wfm/projectHoursServer";
import { getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import NovaAccountStorySlot from "@/components/NovaAccountStorySlot";
import NovaAccountCanvasSlot from "@/components/NovaAccountCanvasSlot";
import Account360Button from "@/components/Account360Button";
import AnalyseButton from "@/components/analysis/AnalyseButton";
import { recordButtonWebhookId, sendToWebhookAction } from "./sendAction";
import { buildAccountStoryEvents, computeAccountHealth } from "@/lib/nova/accountStory";
import { buildAccountCanvas } from "@/lib/nova/accountCanvas";
import { isNovaTenant } from "@/lib/nova/isNovaTenant";
import { formatMoney, resolveCurrency } from "@/lib/currency";

// ── Tone maps ──────────────────────────────────────────────────────────────────

const CASE_TONE: Record<string, PillarKey> = {
  intake: "blue", inspection: "teal",
  report_sent: "amber", report_approved: "green",
  quote_sent: "amber", quote_approved: "green",
  in_repair: "amber", qa: "teal",
  ready: "green", closed: "green",
  buyback: "purple", scrapped: "red",
};
const INVOICE_TONE: Record<InvoiceStatus, PillarKey> = {
  draft: "blue", sent: "amber", partial: "purple", paid: "green", overdue: "red", cancelled: "red",
};
const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", partial: "Partial", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
};
const ACT_TONE: Record<Activity["pillar"], PillarKey> = {
  marketing: "purple", sales: "blue", service: "teal", field: "amber", finance: "green",
};
const TYPE_TONE: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "blue", end_customer: "teal",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// ── Formatters ─────────────────────────────────────────────────────────────────

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// ── Tabs ───────────────────────────────────────────────────────────────────────

type Tab = "overview" | "cases" | "contacts" | "assets" | "quotations" | "projects" | "invoices" | "estimates" | "activity";
// featureKey mirrors Sidebar.tsx's NAV gating — a tab only shows if the
// tenant has that module enabled (tenant.features), same source of truth
// used everywhere else in the app.
const TABS: { id: Tab; label: string; featureKey?: keyof TenantFeatures }[] = [
  { id: "overview",   label: "Overview"   },
  // Every object tab carries its own module's key. Four of these (cases,
  // contacts, assets, quotations) had none until 2026-09-22, so they showed
  // for every tenant regardless of what was sold -- reported on the snasquare
  // workspace, which has none of those modules and saw all four tabs.
  { id: "cases",      label: "Cases",      featureKey: "cases"      },
  { id: "contacts",   label: "Contacts",   featureKey: "contacts"   },
  { id: "assets",     label: "Assets",     featureKey: "assets"     },
  { id: "quotations", label: "Quotations", featureKey: "quotations" },
  { id: "projects",   label: "Projects",  featureKey: "wfm_projects" },
  { id: "invoices",   label: "Invoices",  featureKey: "invoices" },
  { id: "estimates",  label: "Estimates", featureKey: "estimator" },
  { id: "activity",   label: "Activity"   },
];

const refCell = (ref: string | null | undefined) => (
  <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 12.5, color: c.ink }}>{ref ?? "—"}</span>
);

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function AccountHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;

  const [hub, role, tenant] = await Promise.all([getAccountHubLive(id), getUserRole(), getTenant()]);
  if (!hub) notFound();

  const { account, referredBy } = hub;
  const cur = resolveCurrency(tenant?.config);
  const fmtMoney = (n: number) => formatMoney(n, cur, {});
  const features = tenant?.features as TenantFeatures | undefined;
  const quoteStatuses: QuoteStatusDef[] =
    (tenant?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
  const visibleTabs = TABS.filter((t) => !t.featureKey || features?.[t.featureKey] === true);

  // Workforce projects for this account, with this month's hours -- the
  // hours come from the same report the Projects screen and the v1 API use.
  let projectRows: { id: string; ref: string | null; name: string; status: string; level: number; minutes: number; billed_to: string | null }[] = [];
  if (features?.wfm_projects === true && tenant) {
    const admin = createAdminSupabase();
    const { data: projs } = await admin
      .from("wfm_projects").select("id, ref, name, status, parent_id")
      .eq("tenant_id", tenant.id).eq("account_id", id).order("ref");
    if (projs && projs.length > 0) {
      const wfm = await getWfmConfig(admin, tenant.id);
      const today = dateKeyInTz(new Date(), wfm.timezone);
      const [report, { data: billedRows }] = await Promise.all([
        projectHoursReport(admin, tenant.id, `${today.slice(0, 7)}-01`, today).catch(() => null),
        // How far each project has been invoiced (0108). A missing table
        // while the migration is pending just reads as "not yet".
        admin.from("wfm_project_invoices").select("project_id, period_to, invoices!inner(status)")
          .eq("tenant_id", tenant.id).in("project_id", projs.map((p) => p.id as string)),
      ]);
      const billedTo = new Map<string, string>();
      for (const b of billedRows ?? []) {
        const inv = (Array.isArray(b.invoices) ? b.invoices[0] : b.invoices) as { status: string } | null;
        if (inv?.status === "cancelled") continue;
        const pid = b.project_id as string;
        const to = b.period_to as string;
        if (!billedTo.has(pid) || billedTo.get(pid)! < to) billedTo.set(pid, to);
      }
      const minutesOf = (pid: string) => report?.rows.find((r) => r.key === pid)?.total_minutes ?? 0;
      projectRows = projs.map((pr) => ({
        id: pr.id as string, ref: (pr.ref as string | null) ?? null, name: pr.name as string, status: pr.status as string,
        level: report?.projects[pr.id as string]?.depth ?? 0, minutes: minutesOf(pr.id as string),
        billed_to: billedTo.get(pr.id as string) ?? null,
      }));
    }
  }
  // Estimates (0131): customer-facing figures only; empty when the module is off or 0131 is pending.
  const estimateRows = features?.estimator === true ? await estimatesForAccount(id) : [];
  const projectMinutes = projectRows.reduce((s, r) => s + (r.level === 0 ? r.minutes : 0), 0);

  const quotationTotal = hub.quotes.reduce((s, q) => s + q.total, 0);
  const invoiceBalance  = hub.invoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.paid_amount), 0);

  const basePath = ROUTES.account(id);
  const tabHref = (t: Tab) => `${basePath}?tab=${t}`;

  // Cheap in-memory derivation from data the hub already fetched -- no
  // extra queries. NovaAccountStorySlot self-gates, so this runs harmlessly
  // for every tenant rather than threading a theme check through the page.
  const storyEvents = buildAccountStoryEvents({
    accountId: id,
    accountCreatedAt: account.created_at,
    quotes: hub.quotes,
    cases: hub.cases,
    invoices: hub.invoices,
    contracts: hub.contracts,
    cur,
  });
  const health = computeAccountHealth({
    quotes: hub.quotes,
    cases: hub.cases,
    invoices: hub.invoices,
    contacts: hub.contacts,
  });
  const { contactNodes, dealNodes } = buildAccountCanvas({ contacts: hub.contacts, quotes: hub.quotes, cur });
  const openQuoteCount = hub.quotes.filter((q) => q.outcome === "open").length;
  const openQuoteValue = hub.quotes.filter((q) => q.outcome === "open").reduce((t, q) => t + (q.total ?? 0), 0);
  const canvasMeta = `${ACCOUNT_TYPE_LABEL[account.type]} · ${openQuoteCount} open worth ${fmtMoney(openQuoteValue)}`;

  // Nova tenants land on the Story + Constellation view; the classic tabbed
  // hub becomes a distinct "details" destination reached via its own button
  // rather than stacked underneath. No tab param means landing; any tab
  // param (tabHref always sets one, including "Go to details" -> overview)
  // means details -- so a bookmarked/shared tab link still opens directly
  // into the right tab instead of bouncing through the landing view.
  const isNova = isNovaTenant(tenant);
  const showNovaLanding = isNova && !rawTab;

  if (showNovaLanding) {
    return (
      <>
        <TabTitle title={account.name} />
        <div style={{ marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Link href={ROUTES.accounts} style={{ fontSize: 12.5, color: "var(--nova-ink-faint)", textDecoration: "none" }}>
            ← Accounts
          </Link>
          <Link
            href={tabHref("overview")}
            style={{
              fontSize: 12.5, fontWeight: 500, color: "#fff",
              background: "var(--nova-gradient-cta)", borderRadius: 8,
              padding: "8px 16px", textDecoration: "none", flexShrink: 0,
            }}
          >
            Go to details →
          </Link>
        </div>
        <NovaAccountStorySlot accountName={account.name} events={storyEvents} health={health} />
        <NovaAccountCanvasSlot accountName={account.name} accountMeta={canvasMeta} contactNodes={contactNodes} dealNodes={dealNodes} />
      </>
    );
  }

  const quickCreate = [
    // Same gating as the tabs above and as invoices/projects below --
    // offering "New case" to a tenant without the Cases module sends
    // them to a route the nav doesn't even list (snasquare, 2026-09-22).
    ...(features?.cases ? [{ href: `${ROUTES.caseNew}?account_id=${id}`, label: "New case", icon: <ActivityIcon size={13} color={pillar.teal.base} />, bg: pillar.teal.bg }] : []),
    ...(features?.contacts ? [{ href: `${ROUTES.contactNew}?account_id=${id}`, label: "New contact", icon: <Phone size={13} color={pillar.blue.base} />, bg: pillar.blue.bg }] : []),
    ...(features?.assets ? [{ href: `${ROUTES.assetNew}?account_id=${id}`, label: "New asset", icon: <Gear size={13} color={pillar.green.base} />, bg: pillar.green.bg }] : []),
    ...(features?.quotations ? [{ href: `${ROUTES.quotationNew}?account_id=${id}`, label: "New quotation", icon: <Package size={13} color={pillar.amber.base} />, bg: pillar.amber.bg }] : []),
    ...(features?.invoices ? [{ href: `${ROUTES.invoiceNew}?account_id=${id}`, label: "New invoice", icon: <FileText size={13} color={pillar.purple.base} />, bg: pillar.purple.bg }] : []),
    ...(features?.wfm_projects ? [{ href: `${ROUTES.wfmProjectNew}?account=${id}`, label: "New project", icon: <Gear size={13} color={pillar.teal.base} />, bg: pillar.teal.bg }] : []),
  ];

  const tabContent: Record<Tab, React.ReactNode> = {
    overview: (
      <>
        <ObjectSections objectType="account" record={account as unknown as Record<string, unknown>} patchUrl={`/api/accounts/${account.id}`} exclude={["name", "type", "city", "phone", "email"]} />
        {/* The constellation, for a theme that has no Nova landing view to put
            it on -- Spectacular (the slot self-gates, so a tenant on neither
            theme still renders nothing). Overview only: it is a summary of the
            whole account, so repeating it under Quotes or Cases would just push
            the tab's own content down. */}
        {!isNova && <NovaAccountCanvasSlot accountName={account.name} accountMeta={canvasMeta} contactNodes={contactNodes} dealNodes={dealNodes} />}
      </>
    ),
    cases: (
      <RelatedList
        title="Cases"
        newHref={`${ROUTES.caseNew}?account_id=${id}`}
        newLabel="Case"
        emptyText="No cases for this account yet."
        rows={hub.cases}
        rowKey={(sc) => sc.id}
        rowHref={(sc) => ROUTES.case(sc.id)}
        columns={[
          { label: "Ref", render: (sc) => refCell(sc.ref) },
          { label: "Equipment", render: (sc) => <span style={{ fontWeight: 500, color: c.ink }}>{sc.equipment_label || "—"}</span> },
          { label: "Complaint", cellStyle: { maxWidth: 220 }, render: (sc) => (
            <span style={{ fontSize: 12.5, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{sc.complaint || "—"}</span>
          ) },
          { label: "Stage", render: (sc) => <StatusPill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} /> },
          { label: "Type", render: (sc) => <StatusPill label={CASE_TYPE_LABEL[sc.type]} tone="blue" /> },
          { label: "Intake", cellStyle: { color: c.hint, fontSize: 12, whiteSpace: "nowrap" }, render: (sc) => fmtDate(sc.intake_at) },
        ]}
      />
    ),
    contacts: (
      <RelatedList
        title="Contacts"
        newHref={`${ROUTES.contactNew}?account_id=${id}`}
        newLabel="Contact"
        emptyText="No contacts yet."
        rows={hub.contacts}
        rowKey={(ct) => ct.id}
        rowHref={(ct) => ROUTES.contact(ct.id)}
        columns={[
          { label: "Name", render: (ct) => <span style={{ fontWeight: 600, color: c.ink }}>{ct.name}</span> },
          { label: "Role", cellStyle: { color: c.muted }, render: (ct) => ct.role || "—" },
          { label: "Phone", render: (ct) => ct.phone
            ? <a href={`tel:${ct.phone}`} style={{ color: c.accent, textDecoration: "none", fontSize: 13 }}>{ct.phone}</a>
            : <span style={{ color: c.hint }}>—</span> },
          { label: "Email", render: (ct) => ct.email
            ? <a href={`mailto:${ct.email}`} style={{ color: c.muted, textDecoration: "none", fontSize: 12.5 }}>{ct.email}</a>
            : <span style={{ color: c.hint }}>—</span> },
        ]}
      />
    ),
    assets: (
      <RelatedList
        title="Assets"
        newHref={`${ROUTES.assetNew}?account_id=${id}`}
        newLabel="Asset"
        emptyText="No assets registered yet."
        rows={hub.assets}
        rowKey={(a) => a.id}
        rowHref={(a) => ROUTES.asset(a.id)}
        columns={[
          { label: "Asset", render: (a) => <span style={{ fontWeight: 600, color: c.ink }}>{a.name}</span> },
          { label: "Kind", cellStyle: { color: c.muted, textTransform: "capitalize" }, render: (a) => a.kind },
          { label: "Make / Model", cellStyle: { color: c.muted }, render: (a) => [a.make, a.model].filter(Boolean).join(" · ") || "—" },
          { label: "Serial", render: (a) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.hint }}>{a.serial || "—"}</span> },
          { label: "Rating", cellStyle: { color: c.muted }, render: (a) => a.rating || "—" },
        ]}
      />
    ),
    quotations: (
      <RelatedList
        title="Quotations"
        newHref={`${ROUTES.quotationNew}?account_id=${id}`}
        newLabel="Quotation"
        emptyText="No quotations yet."
        summary={quotationTotal > 0 ? <>Total pipeline: <strong style={{ color: c.ink }}>{fmtMoney(quotationTotal)}</strong></> : undefined}
        rows={hub.quotes}
        rowKey={(q) => q.id}
        rowHref={(q) => ROUTES.quotation(q.id)}
        columns={[
          { label: "Ref", render: (q) => refCell(q.ref) },
          { label: "Status", render: (q) => <QuoteStatusPill status={q.status} statuses={quoteStatuses} /> },
          { label: "Amount", render: (q) => <span style={{ fontWeight: 600, color: c.ink }}>{fmtMoney(q.total)}</span> },
          { label: "Valid until", cellStyle: { color: c.hint, fontSize: 12 }, render: (q) => (q.valid_until ? fmtDate(q.valid_until) : "—") },
          { label: "Revision", render: (q) => q.revision > 1
            ? <span style={{ fontSize: 11.5, background: "var(--amberbg)", color: "var(--amberink)", borderRadius: 4, padding: "2px 7px", fontWeight: 600 }}>Rev.{q.revision}</span>
            : <span style={{ color: c.hint }}>—</span> },
        ]}
      />
    ),
    projects: (
      <RelatedList
        title="Projects"
        newHref={`${ROUTES.wfmProjectNew}?account=${id}`}
        newLabel="Project"
        emptyText="No projects for this account yet."
        summary={projectMinutes > 0 ? <>This month: <strong style={{ color: c.ink }}>{Math.floor(projectMinutes / 60)}h {String(Math.round(projectMinutes % 60)).padStart(2, "0")}m</strong></> : undefined}
        rows={projectRows}
        rowKey={(pr) => pr.id}
        rowHref={(pr) => ROUTES.wfmProject(pr.id)}
        columns={[
          { label: "ID", render: (pr) => refCell(pr.ref) },
          { label: "Project", render: (pr) => (
            <span style={{ paddingLeft: pr.level * 14, fontWeight: 600, color: c.ink }}>
              {pr.level > 0 && <span aria-hidden style={{ color: c.hint, marginRight: 6 }}>└</span>}
              {pr.name}
            </span>
          ) },
          { label: "Status", cellStyle: { color: c.muted, textTransform: "capitalize" }, render: (pr) => pr.status.replace("_", " ") },
          { label: "Hours this month", align: "right", cellStyle: { fontVariantNumeric: "tabular-nums" }, render: (pr) => (
            <span style={{ color: pr.minutes > 0 ? c.ink : c.hint }}>
              {pr.minutes > 0 ? `${Math.floor(pr.minutes / 60)}h ${String(Math.round(pr.minutes % 60)).padStart(2, "0")}m` : "—"}
            </span>
          ) },
          { label: "Invoiced to", cellStyle: { whiteSpace: "nowrap" }, render: (pr) => (
            <span style={{ color: pr.billed_to ? c.muted : c.hint }}>
              {pr.billed_to ? new Date(`${pr.billed_to}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "not yet"}
            </span>
          ) },
        ]}
      />
    ),
    estimates: (
      <RelatedList
        title="Estimates"
        newHref={`${ROUTES.estimateNew}?account_id=${id}`}
        newLabel="Estimate"
        emptyText="No estimates yet."
        rows={estimateRows}
        rowKey={(e) => e.id}
        rowHref={(e) => ROUTES.estimate(e.id)}
        columns={[
          { label: "Ref", render: (e) => refCell(e.ref) },
          { label: "Name", render: (e) => <span style={{ fontWeight: 600, color: c.ink }}>{e.name}</span> },
          { label: "Template", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => e.template_name ?? "—" },
          { label: "Status", render: (e) => <StatusPill label={e.status.charAt(0).toUpperCase() + e.status.slice(1)} tone={e.status === "won" ? "green" : e.status === "lost" ? "red" : e.status === "quoted" ? "amber" : "blue"} /> },
          { label: "Price incl. VAT", align: "right", render: (e) => <span style={{ fontWeight: 600, color: c.ink }}>{e.price_incl_vat === null ? "—" : fmtMoney(e.price_incl_vat)}</span> },
        ]}
      />
    ),
    invoices: (
      <RelatedList
        title="Invoices"
        newHref={`${ROUTES.invoiceNew}?account_id=${id}`}
        newLabel="Invoice"
        emptyText="No invoices yet."
        summary={invoiceBalance > 0 ? <>Outstanding: <strong style={{ color: "var(--red)" }}>{fmtMoney(invoiceBalance)}</strong></> : undefined}
        rows={hub.invoices}
        rowKey={(inv) => inv.id}
        rowHref={(inv) => ROUTES.invoice(inv.id)}
        columns={[
          { label: "Ref", render: (inv) => refCell(inv.ref) },
          { label: "Status", render: (inv) => <StatusPill label={INVOICE_LABEL[inv.status]} tone={INVOICE_TONE[inv.status]} /> },
          { label: "Total", render: (inv) => <span style={{ fontWeight: 600, color: c.ink }}>{fmtMoney(inv.total)}</span> },
          { label: "Balance due", render: (inv) => (
            <span style={{ fontWeight: 600, color: inv.total - inv.paid_amount > 0 ? "var(--red)" : c.hint }}>
              {fmtMoney(Math.max(0, inv.total - inv.paid_amount))}
            </span>
          ) },
          { label: "Issued", cellStyle: { color: c.hint, fontSize: 12 }, render: (inv) => (inv.issued_at ? fmtDate(inv.issued_at) : "—") },
        ]}
      />
    ),
    activity: (
      <>
        <Card title={`Activity timeline${hub.activities.length ? ` (${hub.activities.length})` : ""}`}>
          {hub.activities.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            hub.activities.map((act, i) => {
              const tone = pillar[ACT_TONE[act.pillar]];
              const last = i === hub.activities.length - 1;
              return (
                <div key={act.id} style={{ display: "flex", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 5, flexShrink: 0, background: tone.base }} />
                    {!last && <div style={{ flex: 1, width: 1.5, background: c.line, minHeight: 16 }} />}
                  </div>
                  <div style={{ paddingBottom: last ? 0 : 16, fontSize: 13, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StatusPill label={act.pillar} tone={ACT_TONE[act.pillar]} />
                      <span style={{ color: c.hint, fontSize: 12 }}>{fmtDate(act.at)}</span>
                    </div>
                    <div style={{ marginTop: 5, color: c.ink, lineHeight: 1.5 }}>{act.text}</div>
                  </div>
                </div>
              );
            })
          )}
        </Card>
        <RecordActivity objectType="accounts" objectId={id} isAdmin={role === "admin"} />
      </>
    ),
  };

  // Only with the Webhooks library on: the account's "Send to <webhook>" menu entry. Tenants without the flag run no
  // extra query; a missing table (SQL still pending) or an inactive webhook simply means no entry.
  const sendActions: RecordAction[] = [];
  const hookId = (tenant?.features as unknown as Record<string, unknown> | undefined)?.webhooks_library === true ? recordButtonWebhookId(tenant?.config) : null;
  if (tenant && hookId) {
    const { data: hook } = await createAdminSupabase().from("webhooks").select("name")
      .eq("id", hookId).eq("tenant_id", tenant.id).eq("kind", "call").eq("object_type", "accounts").eq("active", true).maybeSingle();
    if (hook?.name) sendActions.push(sendToWebhookAction(account.id, hook.name as string));
  }

  const counts: Partial<Record<Tab, number>> = {
    cases: hub.cases.length, contacts: hub.contacts.length, assets: hub.assets.length,
    quotations: hub.quotes.length, invoices: hub.invoices.length, estimates: estimateRows.length,
  };

  return (
    <ObjectRecordPage
      backHref={ROUTES.accounts}
      backLabel="All accounts"
      title={account.name}
      reference={account.ref}
      status={<StatusPill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />}
      primaryAction={<span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}><Account360Button accountId={account.id} /><AnalyseButton name={account.name} accountId={account.id} /></span>}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: tabHref("overview") }}
          extraItems={isNova ? [{ label: "Back to story", href: basePath }] : []}
          actions={sendActions}
          adapt={{ objectType: "account", objectLabel: "Account", isAdmin: role === "admin" }}
        />
      }
      facts={[
        { label: "City", value: account.city ?? "—" },
        { label: "Phone", value: account.phone ? <a href={`tel:${account.phone}`} style={{ color: "inherit", textDecoration: "none" }}>{account.phone}</a> : "—" },
        { label: "Email", value: account.email ? <a href={`mailto:${account.email}`} style={{ color: "inherit", textDecoration: "none" }}>{account.email}</a> : "—" },
        { label: "Customer since", value: fmtDate(account.created_at) },
      ]}
      externalLine={<ExternalRecordSlot objectType="accounts" objectId={account.id} />}
      basePath={basePath}
      explicitFirstTab
      activeTab={rawTab}
      tabs={visibleTabs.map((t) => ({ id: t.id, label: t.label, count: counts[t.id], content: tabContent[t.id] }))}
      rail={(quickCreate.length > 0 || referredBy) ? (
        <>
          {referredBy && (
            <Card title="Referred by" padding={14}>
              <Link href={ROUTES.account(referredBy.id)} style={{ color: c.accent, textDecoration: "none", fontSize: 13.5, fontWeight: 600 }}>{referredBy.name}</Link>
            </Card>
          )}
          {quickCreate.length > 0 && <QuickCreateDeck items={quickCreate} />}
        </>
      ) : undefined}
    />
  );
}
