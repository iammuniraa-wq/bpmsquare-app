import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ACCOUNT_TYPE_LABEL,
  CASE_STATUS_LABEL,
  CASE_TYPE_LABEL,
  QUOTE_STATUS_LABEL,
} from "@/lib/data";
import { getAccountHubLive } from "@/lib/data/live";
import type { Activity, Account } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import CustomFieldsSection from "@/components/CustomFieldsSection";

// ── Status tone maps ──────────────────────────────────────────────────────────

const CASE_TONE: Record<string, PillarKey> = {
  intake: "blue", inspection: "teal",
  report_sent: "amber", report_approved: "green",
  quote_sent: "amber", quote_approved: "green",
  in_repair: "amber", qa: "teal",
  ready: "green", closed: "green",
  buyback: "purple", scrapped: "red",
};
const QUOTE_TONE: Record<string, PillarKey> = {
  draft: "blue", sent: "amber", approved: "green", rejected: "red",
};
const WO_TONE: Record<string, PillarKey> = {
  scheduled: "blue", in_progress: "amber", completed: "green", invoiced: "teal",
};
const CONTRACT_TONE: Record<string, PillarKey> = {
  active: "teal", expired: "purple", draft: "blue",
};
const ACT_TONE: Record<Activity["pillar"], PillarKey> = {
  marketing: "purple", sales: "blue", service: "teal", field: "amber", finance: "green",
};
const TYPE_TONE: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "blue", end_customer: "teal",
};

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const fmtINR = (n: number) => "₹" + n.toLocaleString("en-IN");

// ── Tab config ────────────────────────────────────────────────────────────────

type Tab = "overview" | "cases" | "contacts" | "assets" | "quotations" | "history";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview",    label: "Overview",    icon: "◴" },
  { id: "cases",       label: "Cases",       icon: "☎" },
  { id: "contacts",    label: "Contacts",    icon: "◉" },
  { id: "assets",      label: "Assets",      icon: "⚙" },
  { id: "quotations",  label: "Quotations",  icon: "₹" },
  { id: "history",     label: "History",     icon: "◷" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHead({
  icon, label, count, meta, newHref, newLabel,
}: {
  icon: string; label: string; count?: number; meta?: string;
  newHref?: string; newLabel?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: c.ink, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        {label}
        {count !== undefined && count > 0 && (
          <span style={{ fontSize: 11, background: c.accentbg, color: c.accent, borderRadius: 4, padding: "1px 7px", fontWeight: 500 }}>
            {count}{meta ? " · " + meta : ""}
          </span>
        )}
      </h3>
      {newHref && (
        <Link href={newHref} style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: `1px solid ${c.accent}30`, borderRadius: 6, padding: "4px 10px", textDecoration: "none" }}>
          + {newLabel ?? "New"}
        </Link>
      )}
    </div>
  );
}

function RecordRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "9px 0", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 8 }}>
      {children}
    </div>
  );
}

function OpenLink({ href }: { href: string }) {
  return (
    <Link href={href} style={{
      fontSize: 11, fontWeight: 600, color: c.accent, textDecoration: "none",
      background: c.accentbg, borderRadius: 6, padding: "3px 8px", flexShrink: 0,
      whiteSpace: "nowrap",
    }}>
      Open →
    </Link>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ color: c.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function AccountHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const activeTab: Tab = (TABS.find((t) => t.id === rawTab)?.id) ?? "overview";

  const hub = await getAccountHubLive(id);
  if (!hub) notFound();

  const { account, referredBy } = hub;

  const openCases       = hub.cases.filter((sc) => !["closed", "buyback", "scrapped"].includes(sc.status));
  const quotationTotal  = hub.quotes.reduce((s, q) => s + q.total, 0);
  const activeContracts = hub.contracts.filter((c) => c.status === "active").length;
  const activeWOs       = hub.workOrders.filter((wo) => wo.status === "in_progress" || wo.status === "scheduled").length;

  const tabHref = (t: Tab) => `${ROUTES.account(id)}?tab=${t}`;

  return (
    <>
      <TabTitle title={account.name} />

      {/* ── Account header ── */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ marginBottom: 10 }}>
          <Link href={ROUTES.accounts} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
            ← All accounts
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px", color: c.ink }}>{account.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />
              {account.city && <span style={{ fontSize: 12.5, color: c.muted }}>📍 {account.city}</span>}
              {referredBy && (
                <span style={{ fontSize: 12.5, color: c.muted }}>
                  via <Link href={ROUTES.account(referredBy.id)} style={{ color: c.accent }}>{referredBy.name}</Link>
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: c.muted, textAlign: "right" }}>
            {account.phone && <span>📞 {account.phone}</span>}
            {account.email && (
              <a href={`mailto:${account.email}`} style={{ color: c.accent, textDecoration: "none" }}>✉ {account.email}</a>
            )}
            <span>Since {fmtDate(account.created_at)}</span>
          </div>
        </div>

        {/* Stat summary row */}
        <div style={{ borderTop: `1px solid ${c.line}`, marginTop: 12, paddingTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 12, color: c.muted }}>
          {hub.contacts.length > 0 && <span><strong style={{ color: c.ink }}>{hub.contacts.length}</strong> {hub.contacts.length === 1 ? "Contact" : "Contacts"}</span>}
          {hub.cases.length > 0 && <span><strong style={{ color: c.ink }}>{hub.cases.length}</strong> Cases{openCases.length > 0 && <span style={{ color: c.accent }}> ({openCases.length} open)</span>}</span>}
          {hub.quotes.length > 0 && <span><strong style={{ color: c.ink }}>{hub.quotes.length}</strong> Quotations{quotationTotal > 0 && <span> · {fmtINR(quotationTotal)}</span>}</span>}
          {hub.contracts.length > 0 && <span><strong style={{ color: c.ink }}>{hub.contracts.length}</strong> AMC{activeContracts > 0 && <span style={{ color: pillar.teal.base }}> ({activeContracts} active)</span>}</span>}
          {hub.workOrders.length > 0 && <span><strong style={{ color: c.ink }}>{hub.workOrders.length}</strong> Work orders{activeWOs > 0 && <span style={{ color: pillar.amber.base }}> ({activeWOs} active)</span>}</span>}
          {hub.assets.length > 0 && <span><strong style={{ color: c.ink }}>{hub.assets.length}</strong> Assets</span>}
          {hub.invoices.length > 0 && <span><strong style={{ color: c.ink }}>{hub.invoices.length}</strong> Invoices</span>}
        </div>

        {/* Quick-create bar */}
        <div style={{ borderTop: `1px solid ${c.line}`, marginTop: 10, paddingTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`${ROUTES.caseNew}?account_id=${id}`} style={quickBtn}>+ New case</Link>
          <Link href={`${ROUTES.contactNew}?account_id=${id}`} style={quickBtn}>+ New contact</Link>
          <Link href={ROUTES.quotationNew} style={quickBtn}>+ New quotation</Link>
          <Link href={`${ROUTES.assetNew}?account_id=${id}`} style={quickBtn}>+ New asset</Link>
        </div>

        <CustomFieldsSection
          objectType="account"
          recordId={account.id}
          customData={(account as Record<string, unknown>).custom_data as Record<string, unknown> | null}
          patchUrl={`/api/accounts/${account.id}`}
        />
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 2, marginBottom: 14, overflowX: "auto", borderBottom: `1px solid ${c.line}` }}>
        {TABS.map((t) => {
          const active = t.id === activeTab;
          const badge = t.id === "cases" ? hub.cases.length
            : t.id === "contacts" ? hub.contacts.length
            : t.id === "assets" ? hub.assets.length
            : t.id === "quotations" ? hub.quotes.length
            : undefined;
          return (
            <Link
              key={t.id}
              href={tabHref(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "8px 14px", fontSize: 12.5, fontWeight: active ? 700 : 500,
                color: active ? c.accent : c.muted, textDecoration: "none",
                borderBottom: active ? `2px solid ${c.accent}` : "2px solid transparent",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              <span>{t.icon}</span>
              {t.label}
              {badge !== undefined && badge > 0 && (
                <span style={{ fontSize: 10, background: active ? c.accentbg : c.panel2, color: active ? c.accent : c.muted, borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 14 }} className="hub-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Contacts preview */}
            <section style={cardStyle}>
              <SectionHead icon="◉" label="Contacts" count={hub.contacts.length} />
              {hub.contacts.length === 0
                ? <div style={{ fontSize: 12.5, color: c.hint, paddingTop: 8 }}>No contacts yet</div>
                : hub.contacts.slice(0, 5).map((ct) => (
                  <div key={ct.id} style={{ padding: "8px 0", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5, color: c.ink }}>{ct.name}</div>
                      <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{ct.role}</div>
                      <div style={{ fontSize: 11, color: c.hint, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {ct.phone && <span>📞 {ct.phone}</span>}
                        {ct.email && <a href={`mailto:${ct.email}`} style={{ color: c.accent, textDecoration: "none" }}>{ct.email}</a>}
                      </div>
                    </div>
                    <OpenLink href={ROUTES.contact(ct.id)} />
                  </div>
                ))
              }
              {hub.contacts.length > 5 && (
                <Link href={tabHref("contacts")} style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                  See all {hub.contacts.length} contacts →
                </Link>
              )}
            </section>

            {/* Assets preview */}
            <section style={cardStyle}>
              <SectionHead icon="⚙" label="Assets" count={hub.assets.length} />
              {hub.assets.length === 0
                ? <div style={{ fontSize: 12.5, color: c.hint, paddingTop: 8 }}>No assets yet</div>
                : hub.assets.slice(0, 5).map((a) => (
                  <RecordRow key={a.id}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: pillar.green.bg, color: pillar.green.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚙</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: c.muted, marginTop: 1 }}>{a.kind}{a.rating ? " · " + a.rating : ""}{a.serial ? " · " + a.serial : ""}</div>
                    </div>
                    <OpenLink href={ROUTES.asset(a.id)} />
                  </RecordRow>
                ))
              }
              {hub.assets.length > 5 && (
                <Link href={tabHref("assets")} style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                  See all {hub.assets.length} assets →
                </Link>
              )}
            </section>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Cases preview */}
            <section style={cardStyle}>
              <SectionHead icon="☎" label="Cases" count={hub.cases.length} meta={openCases.length > 0 ? `${openCases.length} open` : undefined} />
              {hub.cases.length === 0
                ? <div style={{ fontSize: 12.5, color: c.hint, paddingTop: 8 }}>No cases yet</div>
                : hub.cases.slice(0, 5).map((sc) => (
                  <RecordRow key={sc.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{sc.ref}</span>
                        <Pill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} />
                        <Pill label={CASE_TYPE_LABEL[sc.type]} tone="blue" />
                      </div>
                      <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sc.equipment_label}</div>
                      <div style={{ fontSize: 11, color: c.hint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sc.complaint}</div>
                    </div>
                    <OpenLink href={ROUTES.case(sc.id)} />
                  </RecordRow>
                ))
              }
              {hub.cases.length > 5 && (
                <Link href={tabHref("cases")} style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                  See all {hub.cases.length} cases →
                </Link>
              )}
            </section>

            {/* Quotations preview */}
            {hub.quotes.length > 0 && (
              <section style={cardStyle}>
                <SectionHead icon="₹" label="Quotations" count={hub.quotes.length} meta={quotationTotal > 0 ? fmtINR(quotationTotal) : undefined} />
                {hub.quotes.slice(0, 3).map((q) => (
                  <RecordRow key={q.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{q.ref}</span>
                        <Pill label={QUOTE_STATUS_LABEL[q.status]} tone={QUOTE_TONE[q.status] ?? "blue"} />
                      </div>
                      <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3 }}>{fmtINR(q.total)}{q.valid_until ? ` · Valid until ${fmtDate(q.valid_until)}` : ""}</div>
                    </div>
                    <OpenLink href={ROUTES.quotation(q.id)} />
                  </RecordRow>
                ))}
                {hub.quotes.length > 3 && (
                  <Link href={tabHref("quotations")} style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                    See all {hub.quotes.length} quotations →
                  </Link>
                )}
              </section>
            )}

            {/* AMC & Work orders — compact */}
            {(hub.contracts.length > 0 || hub.workOrders.length > 0) && (
              <section style={cardStyle}>
                {hub.contracts.length > 0 && (
                  <>
                    <SectionHead icon="▥" label="AMC contracts" count={hub.contracts.length} meta={activeContracts > 0 ? `${activeContracts} active` : undefined} />
                    {hub.contracts.slice(0, 3).map((ctr) => (
                      <RecordRow key={ctr.id}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{ctr.ref}</span>
                            <Pill label={ctr.status} tone={CONTRACT_TONE[ctr.status] ?? "blue"} />
                          </div>
                          {ctr.value != null && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{fmtINR(ctr.value)}</div>}
                        </div>
                        <OpenLink href={ROUTES.amc} />
                      </RecordRow>
                    ))}
                  </>
                )}
                {hub.workOrders.length > 0 && (
                  <>
                    <div style={{ marginTop: hub.contracts.length > 0 ? 10 : 0 }}>
                      <SectionHead icon="▤" label="Work orders" count={hub.workOrders.length} meta={activeWOs > 0 ? `${activeWOs} active` : undefined} />
                    </div>
                    {hub.workOrders.slice(0, 3).map((wo) => (
                      <RecordRow key={wo.id}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{wo.ref}</span>
                            <Pill label={wo.status.replace("_", " ")} tone={WO_TONE[wo.status] ?? "blue"} />
                          </div>
                          {wo.asset && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{wo.asset.name}</div>}
                        </div>
                        <OpenLink href={ROUTES.workOrder(wo.id)} />
                      </RecordRow>
                    ))}
                  </>
                )}
              </section>
            )}
          </div>
        </div>
      )}

      {/* ── Cases tab ── */}
      {activeTab === "cases" && (
        <section style={cardStyle}>
          <SectionHead icon="☎" label="Cases" count={hub.cases.length} meta={openCases.length > 0 ? `${openCases.length} open` : undefined} newHref={`${ROUTES.caseNew}?account_id=${id}`} newLabel="New case" />
          {hub.cases.length === 0
            ? <EmptyState label="No cases yet" newHref={`${ROUTES.caseNew}?account_id=${id}`} newLabel="Create first case" />
            : hub.cases.map((sc) => (
              <RecordRow key={sc.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{sc.ref}</span>
                    <Pill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} />
                    <Pill label={CASE_TYPE_LABEL[sc.type]} tone="blue" />
                  </div>
                  <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3 }}>{sc.equipment_label}</div>
                  <div style={{ fontSize: 11, color: c.hint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sc.complaint}</div>
                  <div style={{ fontSize: 10.5, color: c.hint, marginTop: 2 }}>{fmtDate(sc.intake_at)}</div>
                </div>
                <OpenLink href={ROUTES.case(sc.id)} />
              </RecordRow>
            ))
          }
        </section>
      )}

      {/* ── Contacts tab ── */}
      {activeTab === "contacts" && (
        <section style={cardStyle}>
          <SectionHead icon="◉" label="Contacts" count={hub.contacts.length} newHref={`${ROUTES.contactNew}?account_id=${id}`} newLabel="New contact" />
          {hub.contacts.length === 0
            ? <EmptyState label="No contacts yet" newHref={`${ROUTES.contactNew}?account_id=${id}`} newLabel="Add first contact" />
            : hub.contacts.map((ct) => (
              <div key={ct.id} style={{ padding: "10px 0", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{ct.name}</div>
                  {ct.role && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{ct.role}</div>}
                  <div style={{ fontSize: 11.5, color: c.hint, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {ct.phone && <span>📞 {ct.phone}</span>}
                    {ct.email && <a href={`mailto:${ct.email}`} style={{ color: c.accent, textDecoration: "none" }}>{ct.email}</a>}
                  </div>
                </div>
                <OpenLink href={ROUTES.contact(ct.id)} />
              </div>
            ))
          }
        </section>
      )}

      {/* ── Assets tab ── */}
      {activeTab === "assets" && (
        <section style={cardStyle}>
          <SectionHead icon="⚙" label="Assets" count={hub.assets.length} newHref={`${ROUTES.assetNew}?account_id=${id}`} newLabel="New asset" />
          {hub.assets.length === 0
            ? <EmptyState label="No assets yet" newHref={`${ROUTES.assetNew}?account_id=${id}`} newLabel="Register first asset" />
            : hub.assets.map((a) => (
              <RecordRow key={a.id}>
                <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: pillar.green.bg, color: pillar.green.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚙</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{a.name}</div>
                  <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ textTransform: "capitalize" }}>{a.kind}</span>
                    {a.make  && <span>· {a.make}</span>}
                    {a.model && <span>· {a.model}</span>}
                    {a.serial && <span style={{ fontFamily: "monospace" }}>· {a.serial}</span>}
                    {a.rating && <span>· {a.rating}</span>}
                  </div>
                </div>
                <OpenLink href={ROUTES.asset(a.id)} />
              </RecordRow>
            ))
          }
        </section>
      )}

      {/* ── Quotations tab ── */}
      {activeTab === "quotations" && (
        <section style={cardStyle}>
          <SectionHead icon="₹" label="Quotations" count={hub.quotes.length} meta={quotationTotal > 0 ? fmtINR(quotationTotal) : undefined} newHref={ROUTES.quotationNew} newLabel="New quotation" />
          {hub.quotes.length === 0
            ? <EmptyState label="No quotations yet" newHref={ROUTES.quotationNew} newLabel="Create first quotation" />
            : hub.quotes.map((q) => (
              <RecordRow key={q.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{q.ref}</span>
                    <Pill label={QUOTE_STATUS_LABEL[q.status]} tone={QUOTE_TONE[q.status] ?? "blue"} />
                    {q.revision > 1 && <span style={{ fontSize: 10, background: "#faeeda", color: "#633806", borderRadius: 5, padding: "1px 6px" }}>Rev.{q.revision}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3, display: "flex", gap: 12 }}>
                    <span style={{ fontWeight: 600, color: c.ink }}>{fmtINR(q.total)}</span>
                    {q.valid_until && <span>Valid until {fmtDate(q.valid_until)}</span>}
                  </div>
                </div>
                <OpenLink href={ROUTES.quotation(q.id)} />
              </RecordRow>
            ))
          }
        </section>
      )}

      {/* ── History tab ── */}
      {activeTab === "history" && (
        <section style={cardStyle}>
          <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 600, color: c.ink }}>Activity timeline</h3>
          {hub.activities.length === 0
            ? <div style={{ fontSize: 12.5, color: c.hint, textAlign: "center", padding: "24px 0" }}>No activity recorded yet</div>
            : hub.activities.map((act, i) => {
              const tone = pillar[ACT_TONE[act.pillar]];
              const last = i === hub.activities.length - 1;
              return (
                <div key={act.id} style={{ display: "flex", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 5, flexShrink: 0, background: tone.base }} />
                    {!last && <div style={{ flex: 1, width: 1.5, background: c.line, minHeight: 14 }} />}
                  </div>
                  <div style={{ paddingBottom: last ? 0 : 14, fontSize: 12.5, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <Pill label={act.pillar} tone={ACT_TONE[act.pillar]} />
                      <span style={{ color: c.hint, fontSize: 11 }}>{fmtDate(act.at)}</span>
                    </div>
                    <div style={{ marginTop: 4, color: c.ink }}>{act.text}</div>
                  </div>
                </div>
              );
            })
          }
        </section>
      )}
    </>
  );
}

// ── Shared empty state ────────────────────────────────────────────────────────

function EmptyState({ label, newHref, newLabel }: { label: string; newHref: string; newLabel: string }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 16px" }}>
      <div style={{ fontSize: 13, color: c.hint, marginBottom: 10 }}>{label}</div>
      <Link href={newHref} style={{ fontSize: 13, fontWeight: 600, color: c.accent, background: c.accentbg, borderRadius: 7, padding: "7px 16px", textDecoration: "none" }}>
        + {newLabel}
      </Link>
    </div>
  );
}

const quickBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg,
  border: `1px solid ${c.accent}25`, borderRadius: 6, padding: "5px 12px",
  textDecoration: "none", whiteSpace: "nowrap",
};
