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
import { MapPin, Phone, Mail, Gear } from "@/components/Icons";

// ── Tone maps ─────────────────────────────────────────────────────────────────

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

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "cases" | "contacts" | "assets" | "quotations" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview",   label: "Overview"   },
  { id: "cases",      label: "Cases"      },
  { id: "contacts",   label: "Contacts"   },
  { id: "assets",     label: "Assets"     },
  { id: "quotations", label: "Quotations" },
  { id: "history",    label: "History"    },
];

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionHead({ label, count, meta, newHref, newLabel }: {
  label: string; count?: number; meta?: string; newHref?: string; newLabel?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 6 }}>
        {label}
        {count !== undefined && count > 0 && (
          <span style={{ fontSize: 11, background: c.accentbg, color: c.accent, borderRadius: 4, padding: "1px 6px", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
            {count}{meta ? " · " + meta : ""}
          </span>
        )}
      </h3>
      {newHref && (
        <Link href={newHref} style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: c.accentbg, border: `1px solid ${c.accent}25`, borderRadius: 6, padding: "3px 9px", textDecoration: "none" }}>
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
      fontSize: 11, fontWeight: 600, color: c.accent,
      background: c.accentbg, borderRadius: 6, padding: "3px 8px",
      textDecoration: "none", flexShrink: 0, whiteSpace: "nowrap",
    }}>
      Open →
    </Link>
  );
}

// Key-value row used in the details sidebar
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "6px 0", borderTop: `1px solid ${c.line}`, fontSize: 12.5 }}>
      <span style={{ color: c.hint, flexShrink: 0, fontSize: 11.5 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.ink, fontWeight: 500 }}>{children}</span>
    </div>
  );
}

function EmptyState({ label, newHref, newLabel }: { label: string; newHref: string; newLabel: string }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 12px" }}>
      <div style={{ fontSize: 12.5, color: c.hint, marginBottom: 10 }}>{label}</div>
      <Link href={newHref} style={{ fontSize: 12.5, fontWeight: 600, color: c.accent, background: c.accentbg, borderRadius: 7, padding: "6px 14px", textDecoration: "none" }}>
        + {newLabel}
      </Link>
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

  const openCases      = hub.cases.filter((sc) => !["closed", "buyback", "scrapped"].includes(sc.status));
  const closedCases    = hub.cases.filter((sc) =>  ["closed", "buyback", "scrapped"].includes(sc.status));
  const quotationTotal = hub.quotes.reduce((s, q) => s + q.total, 0);
  const activeContracts = hub.contracts.filter((c) => c.status === "active").length;
  const activeWOs      = hub.workOrders.filter((wo) => wo.status === "in_progress" || wo.status === "scheduled").length;

  const tabHref = (t: Tab) => `${ROUTES.account(id)}?tab=${t}`;

  // Quick-create buttons — reused in header
  const quickLinks = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Link href={`${ROUTES.caseNew}?account_id=${id}`}    style={quickBtn}>+ Case</Link>
      <Link href={`${ROUTES.contactNew}?account_id=${id}`} style={quickBtn}>+ Contact</Link>
      <Link href={ROUTES.quotationNew}                      style={quickBtn}>+ Quotation</Link>
      <Link href={`${ROUTES.assetNew}?account_id=${id}`}   style={quickBtn}>+ Asset</Link>
    </div>
  );

  return (
    <>
      <TabTitle title={account.name} />

      {/* ── Account identity card ── */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>

        {/* breadcrumb */}
        <div style={{ marginBottom: 12 }}>
          <Link href={ROUTES.accounts} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
            ← All accounts
          </Link>
        </div>

        {/* Name + type + quick-create on same row (desktop); stacked on mobile */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px", color: c.ink }}>{account.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />
              {account.city && <span style={{ fontSize: 12, color: c.muted, display: "flex", alignItems: "center", gap: 4 }}><MapPin size={12} color={c.hint} /> {account.city}</span>}
              {referredBy && (
                <span style={{ fontSize: 12, color: c.muted }}>
                  via <Link href={ROUTES.account(referredBy.id)} style={{ color: c.accent }}>{referredBy.name}</Link>
                </span>
              )}
              <span style={{ fontSize: 11.5, color: c.hint }}>Since {fmtDate(account.created_at)}</span>
            </div>
          </div>
          {/* Quick-create: hidden on mobile (shown below) */}
          <div className="mob-hide">{quickLinks}</div>
        </div>

        {/* Quick-create on mobile — below name */}
        <div className="mob-show" style={{ marginTop: 12 }}>{quickLinks}</div>


      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, overflowX: "auto", borderBottom: `1px solid ${c.line}` }}>
        {TABS.map((t) => {
          const active = t.id === activeTab;
          const badge  = t.id === "cases"      ? hub.cases.length
                       : t.id === "contacts"   ? hub.contacts.length
                       : t.id === "assets"     ? hub.assets.length
                       : t.id === "quotations" ? hub.quotes.length
                       : undefined;
          return (
            <Link key={t.id} href={tabHref(t.id)} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "8px 14px", fontSize: 12.5, fontWeight: active ? 700 : 500,
              color: active ? c.accent : c.muted, textDecoration: "none",
              borderBottom: active ? `2px solid ${c.accent}` : "2px solid transparent",
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
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

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── OVERVIEW TAB ──────────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      {activeTab === "overview" && (
        // 2-col layout: narrow details sidebar | wide live data
        // hub-grid collapses to single column on mobile (≤780px)
        <div
          className="hub-grid"
          style={{ display: "grid", gridTemplateColumns: "minmax(0,280px) minmax(0,1fr)", gap: 14, alignItems: "start" }}
        >

          {/* ── LEFT: Account details sidebar ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Account details */}
            <section style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Account details
              </div>

              <DetailRow label="Type">
                <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />
              </DetailRow>

              {account.city && (
                <DetailRow label="City">{account.city}</DetailRow>
              )}

              {account.phone && (
                <DetailRow label="Phone">
                  <a href={`tel:${account.phone}`} style={{ color: c.accent, textDecoration: "none" }}>
                    {account.phone}
                  </a>
                </DetailRow>
              )}

              {account.email && (
                <DetailRow label="Email">
                  <a href={`mailto:${account.email}`} style={{ color: c.accent, textDecoration: "none", wordBreak: "break-all" }}>
                    {account.email}
                  </a>
                </DetailRow>
              )}

              {referredBy && (
                <DetailRow label="Via OEM">
                  <Link href={ROUTES.account(referredBy.id)} style={{ color: c.accent }}>
                    {referredBy.name}
                  </Link>
                </DetailRow>
              )}

              <DetailRow label="Customer since">{fmtDate(account.created_at)}</DetailRow>

              {/* Custom fields (GST, credit terms, payment terms, etc.) inline in sidebar */}
              <div style={{ marginTop: 8 }}>
                <CustomFieldsSection
                  objectType="account"
                  recordId={account.id}
                  customData={(account as Record<string, unknown>).custom_data as Record<string, unknown> | null}
                  patchUrl={`/api/accounts/${account.id}`}
                />
              </div>
            </section>

            {/* Contacts — primary people to call */}
            <section style={cardStyle}>
              <SectionHead label="Contacts" count={hub.contacts.length} newHref={`${ROUTES.contactNew}?account_id=${id}`} newLabel="Add" />

              {hub.contacts.length === 0 ? (
                <div style={{ fontSize: 12, color: c.hint, padding: "8px 0" }}>No contacts yet</div>
              ) : (
                hub.contacts.map((ct, i) => (
                  <div key={ct.id} style={{ paddingTop: i === 0 ? 8 : 10, paddingBottom: 4, borderTop: i === 0 ? `1px solid ${c.line}` : undefined }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12.5, color: c.ink }}>{ct.name}</div>
                        {ct.role && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 1 }}>{ct.role}</div>}
                      </div>
                      <OpenLink href={ROUTES.contact(ct.id)} />
                    </div>
                    {/* Phone + email — tap-friendly on mobile */}
                    <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
                      {ct.phone && (
                        <a href={`tel:${ct.phone}`} style={{ fontSize: 12, color: c.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
                          <Phone size={12} color={c.accent} /> {ct.phone}
                        </a>
                      )}
                      {ct.email && (
                        <a href={`mailto:${ct.email}`} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none", display: "flex", alignItems: "center", gap: 5, wordBreak: "break-all" }}>
                          <Mail size={12} color={c.hint} /> {ct.email}
                        </a>
                      )}
                    </div>
                    {i < hub.contacts.length - 1 && (
                      <div style={{ marginTop: 10, borderBottom: `1px solid ${c.line}` }} />
                    )}
                  </div>
                ))
              )}

              {hub.contacts.length > 4 && (
                <Link href={tabHref("contacts")} style={{ display: "block", textAlign: "center", marginTop: 10, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                  See all {hub.contacts.length} →
                </Link>
              )}
            </section>
          </div>

          {/* ── RIGHT: Live activity data ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Open cases — the most actionable data */}
            <section style={cardStyle}>
              <SectionHead
                label="Open cases"
                count={openCases.length}
                newHref={`${ROUTES.caseNew}?account_id=${id}`}
                newLabel="New case"
              />

              {openCases.length === 0 ? (
                <div style={{ fontSize: 12.5, color: c.hint, padding: "12px 0", textAlign: "center" }}>
                  No open cases
                  <br />
                  <Link href={`${ROUTES.caseNew}?account_id=${id}`} style={{ color: c.accent, fontSize: 12, marginTop: 6, display: "inline-block" }}>
                    + Create first case
                  </Link>
                </div>
              ) : (
                openCases.map((sc) => (
                  <div key={sc.id} style={{
                    padding: "10px 12px", marginTop: 8, borderRadius: 8,
                    background: c.panel2, border: `1px solid ${c.line}`,
                    display: "flex", alignItems: "flex-start", gap: 10,
                  }}>
                    {/* Status dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                      background: pillar[CASE_TONE[sc.status] ?? "blue"]?.base ?? c.accent,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: c.ink, fontFamily: "monospace" }}>{sc.ref}</span>
                        <Pill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} />
                        <Pill label={CASE_TYPE_LABEL[sc.type]} tone="blue" />
                      </div>
                      <div style={{ fontSize: 12, color: c.muted, marginTop: 3, fontWeight: 500 }}>{sc.equipment_label}</div>
                      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sc.complaint}
                      </div>
                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 10.5, color: c.hint }}>{fmtDate(sc.intake_at)}</span>
                        <OpenLink href={ROUTES.case(sc.id)} />
                      </div>
                    </div>
                  </div>
                ))
              )}

              {closedCases.length > 0 && (
                <Link href={tabHref("cases")} style={{ display: "block", marginTop: 10, fontSize: 12, color: c.muted, textDecoration: "none" }}>
                  + {closedCases.length} closed case{closedCases.length > 1 ? "s" : ""} →
                </Link>
              )}
            </section>

            {/* Assets */}
            {hub.assets.length > 0 && (
              <section style={cardStyle}>
                <SectionHead label="Assets" count={hub.assets.length} newHref={`${ROUTES.assetNew}?account_id=${id}`} newLabel="New asset" />
                {hub.assets.slice(0, 4).map((a) => (
                  <RecordRow key={a.id}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: pillar.green.bg, color: pillar.green.fg, display: "flex", alignItems: "center", justifyContent: "center" }}><Gear size={14} color={pillar.green.fg} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: c.muted, marginTop: 1, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ textTransform: "capitalize" }}>{a.kind}</span>
                        {a.make  && <span>· {a.make}</span>}
                        {a.serial && <span style={{ fontFamily: "monospace" }}>· {a.serial}</span>}
                      </div>
                    </div>
                    <OpenLink href={ROUTES.asset(a.id)} />
                  </RecordRow>
                ))}
                {hub.assets.length > 4 && (
                  <Link href={tabHref("assets")} style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                    See all {hub.assets.length} assets →
                  </Link>
                )}
              </section>
            )}

            {/* Quotations */}
            {hub.quotes.length > 0 && (
              <section style={cardStyle}>
                <SectionHead
                  label="Quotations"
                  count={hub.quotes.length}
                  meta={quotationTotal > 0 ? fmtINR(quotationTotal) : undefined}
                  newHref={ROUTES.quotationNew}
                  newLabel="New"
                />
                {hub.quotes.slice(0, 4).map((q) => (
                  <RecordRow key={q.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, fontFamily: "monospace" }}>{q.ref}</span>
                        <Pill label={QUOTE_STATUS_LABEL[q.status]} tone={QUOTE_TONE[q.status] ?? "blue"} />
                      </div>
                      <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, display: "flex", gap: 10 }}>
                        <span style={{ fontWeight: 600, color: c.ink }}>{fmtINR(q.total)}</span>
                        {q.valid_until && <span style={{ color: c.hint }}>Valid till {fmtDate(q.valid_until)}</span>}
                      </div>
                    </div>
                    <OpenLink href={ROUTES.quotation(q.id)} />
                  </RecordRow>
                ))}
                {hub.quotes.length > 4 && (
                  <Link href={tabHref("quotations")} style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                    See all {hub.quotes.length} →
                  </Link>
                )}
              </section>
            )}

            {/* AMC + Work orders — compact combined card */}
            {(hub.contracts.length > 0 || hub.workOrders.length > 0) && (
              <section style={cardStyle}>
                {hub.contracts.length > 0 && (
                  <>
                    <SectionHead label="AMC contracts" count={hub.contracts.length} meta={activeContracts > 0 ? `${activeContracts} active` : undefined} />
                    {hub.contracts.slice(0, 3).map((ctr) => (
                      <RecordRow key={ctr.id}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, fontFamily: "monospace" }}>{ctr.ref}</span>
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
                  <div style={{ marginTop: hub.contracts.length > 0 ? 12 : 0 }}>
                    <SectionHead label="Work orders" count={hub.workOrders.length} meta={activeWOs > 0 ? `${activeWOs} active` : undefined} />
                    {hub.workOrders.slice(0, 3).map((wo) => (
                      <RecordRow key={wo.id}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, fontFamily: "monospace" }}>{wo.ref}</span>
                            <Pill label={wo.status.replace("_", " ")} tone={WO_TONE[wo.status] ?? "blue"} />
                          </div>
                          {wo.asset && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{wo.asset.name}</div>}
                        </div>
                        <OpenLink href={ROUTES.workOrder(wo.id)} />
                      </RecordRow>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── CASES TAB ─────────────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      {activeTab === "cases" && (
        <section style={cardStyle}>
          <SectionHead label="Cases" count={hub.cases.length} meta={openCases.length > 0 ? `${openCases.length} open` : undefined} newHref={`${ROUTES.caseNew}?account_id=${id}`} newLabel="New case" />
          {hub.cases.length === 0
            ? <EmptyState label="No cases yet" newHref={`${ROUTES.caseNew}?account_id=${id}`} newLabel="Create first case" />
            : hub.cases.map((sc) => (
              <RecordRow key={sc.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, fontFamily: "monospace" }}>{sc.ref}</span>
                    <Pill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} />
                    <Pill label={CASE_TYPE_LABEL[sc.type]} tone="blue" />
                  </div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>{sc.equipment_label}</div>
                  <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sc.complaint}</div>
                  <div style={{ fontSize: 10.5, color: c.hint, marginTop: 2 }}>{fmtDate(sc.intake_at)}</div>
                </div>
                <OpenLink href={ROUTES.case(sc.id)} />
              </RecordRow>
            ))
          }
        </section>
      )}

      {/* ── CONTACTS TAB ── */}
      {activeTab === "contacts" && (
        <section style={cardStyle}>
          <SectionHead label="Contacts" count={hub.contacts.length} newHref={`${ROUTES.contactNew}?account_id=${id}`} newLabel="New contact" />
          {hub.contacts.length === 0
            ? <EmptyState label="No contacts yet" newHref={`${ROUTES.contactNew}?account_id=${id}`} newLabel="Add first contact" />
            : hub.contacts.map((ct) => (
              <div key={ct.id} style={{ padding: "10px 0", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{ct.name}</div>
                  {ct.role && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{ct.role}</div>}
                  <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
                    {ct.phone && (
                      <a href={`tel:${ct.phone}`} style={{ fontSize: 12.5, color: c.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
                        <Phone size={13} color={c.accent} /> {ct.phone}
                      </a>
                    )}
                    {ct.email && (
                      <a href={`mailto:${ct.email}`} style={{ fontSize: 12, color: c.muted, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
                        <Mail size={12} color={c.hint} /> {ct.email}
                      </a>
                    )}
                  </div>
                </div>
                <OpenLink href={ROUTES.contact(ct.id)} />
              </div>
            ))
          }
        </section>
      )}

      {/* ── ASSETS TAB ── */}
      {activeTab === "assets" && (
        <section style={cardStyle}>
          <SectionHead label="Assets" count={hub.assets.length} newHref={`${ROUTES.assetNew}?account_id=${id}`} newLabel="New asset" />
          {hub.assets.length === 0
            ? <EmptyState label="No assets yet" newHref={`${ROUTES.assetNew}?account_id=${id}`} newLabel="Register first asset" />
            : hub.assets.map((a) => (
              <RecordRow key={a.id}>
                <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: pillar.green.bg, color: pillar.green.fg, display: "flex", alignItems: "center", justifyContent: "center" }}><Gear size={16} color={pillar.green.fg} /></div>
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

      {/* ── QUOTATIONS TAB ── */}
      {activeTab === "quotations" && (
        <section style={cardStyle}>
          <SectionHead label="Quotations" count={hub.quotes.length} meta={quotationTotal > 0 ? fmtINR(quotationTotal) : undefined} newHref={ROUTES.quotationNew} newLabel="New quotation" />
          {hub.quotes.length === 0
            ? <EmptyState label="No quotations yet" newHref={ROUTES.quotationNew} newLabel="Create first quotation" />
            : hub.quotes.map((q) => (
              <RecordRow key={q.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, fontFamily: "monospace" }}>{q.ref}</span>
                    <Pill label={QUOTE_STATUS_LABEL[q.status]} tone={QUOTE_TONE[q.status] ?? "blue"} />
                    {q.revision > 1 && <span style={{ fontSize: 10, background: "#faeeda", color: "#633806", borderRadius: 5, padding: "1px 5px" }}>Rev.{q.revision}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3, display: "flex", gap: 12 }}>
                    <span style={{ fontWeight: 600, color: c.ink }}>{fmtINR(q.total)}</span>
                    {q.valid_until && <span>Valid till {fmtDate(q.valid_until)}</span>}
                  </div>
                </div>
                <OpenLink href={ROUTES.quotation(q.id)} />
              </RecordRow>
            ))
          }
        </section>
      )}

      {/* ── HISTORY TAB ── */}
      {activeTab === "history" && (
        <section style={cardStyle}>
          <h3 style={{ margin: "0 0 14px", fontSize: 12, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>Activity timeline</h3>
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

// ── Shared styles ─────────────────────────────────────────────────────────────

const quickBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg,
  border: `1px solid ${c.accent}25`, borderRadius: 6, padding: "5px 10px",
  textDecoration: "none", whiteSpace: "nowrap",
};
