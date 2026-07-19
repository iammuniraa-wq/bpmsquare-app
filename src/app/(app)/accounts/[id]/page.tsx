import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ACCOUNT_TYPE_LABEL,
  CASE_STATUS_LABEL,
  CASE_TYPE_LABEL,
  QUOTE_STATUS_LABEL,
} from "@/lib/data";
import { getAccountHubLive } from "@/lib/data/live";
import { getUserRole } from "@/lib/tenant";
import type { Activity, Account, InvoiceStatus } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import ObjectSections from "@/components/fields/ObjectSections";
import QuickCreateDeck from "@/components/QuickCreateDeck";
import { MapPin, Phone, Mail, Gear, Activity as ActivityIcon, Package, FileText } from "@/components/Icons";
import AccountHeader from "./AccountHeader";

// ── Tone maps ──────────────────────────────────────────────────────────────────

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

// ── Formatters ─────────────────────────────────────────────────────────────────

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const fmtINR = (n: number) => "₹" + n.toLocaleString("en-IN");

// ── Tabs ───────────────────────────────────────────────────────────────────────

type Tab = "overview" | "cases" | "contacts" | "assets" | "quotations" | "invoices" | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview",   label: "Overview"   },
  { id: "cases",      label: "Cases"      },
  { id: "contacts",   label: "Contacts"   },
  { id: "assets",     label: "Assets"     },
  { id: "quotations", label: "Quotations" },
  { id: "invoices",   label: "Invoices"   },
  { id: "activity",   label: "Activity"   },
];

// ── Shared sub-components ──────────────────────────────────────────────────────

function SectionHead({ label, count, action }: {
  label: string; count?: number; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </span>
        {count !== undefined && count > 0 && (
          <span style={{ fontSize: 11, background: c.accentbg, color: c.accent, borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

function AddLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{
      fontSize: 12, fontWeight: 600, color: c.accent,
      background: c.accentbg, border: `1px solid ${c.accent}25`,
      borderRadius: 6, padding: "4px 10px", textDecoration: "none",
    }}>
      + {label}
    </Link>
  );
}

function OpenLink({ href }: { href: string }) {
  return (
    <Link href={href} style={{
      fontSize: 11.5, fontWeight: 600, color: c.accent,
      background: c.accentbg, borderRadius: 6, padding: "4px 10px",
      textDecoration: "none", flexShrink: 0, whiteSpace: "nowrap",
    }}>
      Open →
    </Link>
  );
}

function EmptyRow({ label, href, linkLabel }: { label: string; href: string; linkLabel: string }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 16px" }}>
      <div style={{ fontSize: 13, color: c.hint, marginBottom: 12 }}>{label}</div>
      <Link href={href} style={{
        fontSize: 13, fontWeight: 600, color: c.accent,
        background: c.accentbg, borderRadius: 7, padding: "7px 16px", textDecoration: "none",
      }}>
        + {linkLabel}
      </Link>
    </div>
  );
}

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
  const activeTab: Tab = (TABS.find((t) => t.id === rawTab)?.id) ?? "overview";

  const [hub, role] = await Promise.all([getAccountHubLive(id), getUserRole()]);
  if (!hub) notFound();

  const { account, referredBy } = hub;

  const quotationTotal = hub.quotes.reduce((s, q) => s + q.total, 0);
  const invoiceBalance  = hub.invoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.paid_amount), 0);

  const tabHref = (t: Tab) => `${ROUTES.account(id)}?tab=${t}`;

  return (
    <>
      <TabTitle title={account.name} />

      {/* ── Breadcrumb ── */}
      <div style={{ marginBottom: 10 }}>
        <Link href={ROUTES.accounts} style={{ fontSize: 12.5, color: c.muted, textDecoration: "none" }}>
          ← Accounts
        </Link>
      </div>

      {/* ── Account header ────────────────────────────────────────────────── */}
      <AccountHeader isAdmin={role === "admin"}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: c.ink }}>{account.name}</h1>
            <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 13, color: c.muted }}>
            {account.city && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <MapPin size={12} color={c.hint} /> {account.city}
              </span>
            )}
            {account.phone && (
              <a href={`tel:${account.phone}`} style={{ display: "flex", alignItems: "center", gap: 4, color: c.muted, textDecoration: "none" }}>
                <Phone size={12} color={c.hint} /> {account.phone}
              </a>
            )}
            {account.email && (
              <a href={`mailto:${account.email}`} style={{ display: "flex", alignItems: "center", gap: 4, color: c.muted, textDecoration: "none" }}>
                <Mail size={12} color={c.hint} /> {account.email}
              </a>
            )}
            {referredBy && (
              <span>via <Link href={ROUTES.account(referredBy.id)} style={{ color: c.accent, textDecoration: "none" }}>{referredBy.name}</Link></span>
            )}
            <span style={{ color: c.hint }}>Since {fmtDate(account.created_at)}</span>
          </div>
        </div>
      </AccountHeader>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: `1px solid ${c.line}`, overflowX: "auto" }}>
        {TABS.map((t) => {
          const active = t.id === activeTab;
          const badge  = t.id === "cases"      ? hub.cases.length
                       : t.id === "contacts"   ? hub.contacts.length
                       : t.id === "assets"     ? hub.assets.length
                       : t.id === "quotations" ? hub.quotes.length
                       : t.id === "invoices"   ? hub.invoices.length
                       : undefined;
          return (
            <Link key={t.id} href={tabHref(t.id)} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "10px 16px", fontSize: 13.5, fontWeight: active ? 700 : 500,
              color: active ? c.accent : c.muted, textDecoration: "none",
              borderBottom: active ? `2.5px solid ${c.accent}` : "2.5px solid transparent",
              whiteSpace: "nowrap", flexShrink: 0, transition: ".12s",
            }}>
              {t.label}
              {badge !== undefined && badge > 0 && (
                <span style={{
                  fontSize: 10.5, background: active ? c.accentbg : c.panel2,
                  color: active ? c.accent : c.muted,
                  borderRadius: 4, padding: "1px 6px", fontWeight: 600,
                }}>
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* OVERVIEW                                                            */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {activeTab === "overview" && (
        <div className="hub-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 14, alignItems: "start" }}>

          {/* LEFT: Account details only — everything else (cases, contacts,
              assets, quotations, invoices) already has its own tab above. */}
          <ObjectSections objectType="account" record={account as unknown as Record<string, unknown>} patchUrl={`/api/accounts/${account.id}`} />

          {/* RIGHT: Quick create — jump straight into a related object */}
          <QuickCreateDeck items={[
            { href: `${ROUTES.caseNew}?account_id=${id}`,      label: "New case",       icon: <ActivityIcon size={13} color={pillar.teal.base} />, bg: pillar.teal.bg },
            { href: `${ROUTES.contactNew}?account_id=${id}`,   label: "New contact",    icon: <Phone size={13} color={pillar.blue.base} />,     bg: pillar.blue.bg },
            { href: `${ROUTES.assetNew}?account_id=${id}`,     label: "New asset",      icon: <Gear size={13} color={pillar.green.base} />,     bg: pillar.green.bg },
            { href: ROUTES.quotationNew,                       label: "New quotation",  icon: <Package size={13} color={pillar.amber.base} />,  bg: pillar.amber.bg },
            { href: ROUTES.invoiceNew,                         label: "New invoice",    icon: <FileText size={13} color={pillar.purple.base} />, bg: pillar.purple.bg },
          ]} />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* CASES TAB                                                           */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {activeTab === "cases" && (
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionHead label="Cases" count={hub.cases.length} action={<AddLink href={`${ROUTES.caseNew}?account_id=${id}`} label="New case" />} />
          </div>
          {hub.cases.length === 0 ? (
            <EmptyRow label="No cases for this account yet." href={`${ROUTES.caseNew}?account_id=${id}`} linkLabel="Create first case" />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: c.panel2 }}>
                  <th style={th2}>Ref</th>
                  <th style={th2}>Equipment</th>
                  <th style={th2}>Complaint</th>
                  <th style={th2}>Stage</th>
                  <th style={th2}>Type</th>
                  <th style={th2}>Intake</th>
                  <th style={th2}></th>
                </tr>
              </thead>
              <tbody>
                {hub.cases.map((sc, i) => (
                  <tr key={sc.id} style={{ borderTop: `1px solid ${c.line}`, background: i % 2 === 1 ? c.panel2 : "#fff" }}>
                    <td style={td2}><span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5, color: c.ink }}>{sc.ref}</span></td>
                    <td style={td2}><span style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>{sc.equipment_label || "—"}</span></td>
                    <td style={{ ...td2, maxWidth: 220 }}>
                      <span style={{ fontSize: 12.5, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                        {sc.complaint || "—"}
                      </span>
                    </td>
                    <td style={td2}><Pill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} /></td>
                    <td style={td2}><Pill label={CASE_TYPE_LABEL[sc.type]} tone="blue" /></td>
                    <td style={{ ...td2, color: c.hint, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(sc.intake_at)}</td>
                    <td style={td2}><OpenLink href={ROUTES.case(sc.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* CONTACTS TAB                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {activeTab === "contacts" && (
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionHead label="Contacts" count={hub.contacts.length} action={<AddLink href={`${ROUTES.contactNew}?account_id=${id}`} label="New contact" />} />
          </div>
          {hub.contacts.length === 0 ? (
            <EmptyRow label="No contacts yet." href={`${ROUTES.contactNew}?account_id=${id}`} linkLabel="Add first contact" />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: c.panel2 }}>
                  <th style={th2}>Name</th>
                  <th style={th2}>Role</th>
                  <th style={th2}>Phone</th>
                  <th style={th2}>Email</th>
                  <th style={th2}></th>
                </tr>
              </thead>
              <tbody>
                {hub.contacts.map((ct, i) => (
                  <tr key={ct.id} style={{ borderTop: `1px solid ${c.line}`, background: i % 2 === 1 ? c.panel2 : "#fff" }}>
                    <td style={td2}><span style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{ct.name}</span></td>
                    <td style={{ ...td2, color: c.muted }}>{ct.role || "—"}</td>
                    <td style={td2}>
                      {ct.phone
                        ? <a href={`tel:${ct.phone}`} style={{ color: c.accent, textDecoration: "none", fontSize: 13 }}>{ct.phone}</a>
                        : <span style={{ color: c.hint }}>—</span>}
                    </td>
                    <td style={td2}>
                      {ct.email
                        ? <a href={`mailto:${ct.email}`} style={{ color: c.muted, textDecoration: "none", fontSize: 12.5 }}>{ct.email}</a>
                        : <span style={{ color: c.hint }}>—</span>}
                    </td>
                    <td style={td2}><OpenLink href={ROUTES.contact(ct.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* ASSETS TAB                                                          */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {activeTab === "assets" && (
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionHead label="Assets" count={hub.assets.length} action={<AddLink href={`${ROUTES.assetNew}?account_id=${id}`} label="New asset" />} />
          </div>
          {hub.assets.length === 0 ? (
            <EmptyRow label="No assets registered yet." href={`${ROUTES.assetNew}?account_id=${id}`} linkLabel="Register first asset" />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: c.panel2 }}>
                  <th style={th2}>Asset</th>
                  <th style={th2}>Kind</th>
                  <th style={th2}>Make / Model</th>
                  <th style={th2}>Serial</th>
                  <th style={th2}>Rating</th>
                  <th style={th2}></th>
                </tr>
              </thead>
              <tbody>
                {hub.assets.map((a, i) => (
                  <tr key={a.id} style={{ borderTop: `1px solid ${c.line}`, background: i % 2 === 1 ? c.panel2 : "#fff" }}>
                    <td style={td2}><span style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{a.name}</span></td>
                    <td style={{ ...td2, color: c.muted, textTransform: "capitalize" }}>{a.kind}</td>
                    <td style={{ ...td2, color: c.muted }}>{[a.make, a.model].filter(Boolean).join(" · ") || "—"}</td>
                    <td style={td2}><span style={{ fontFamily: "monospace", fontSize: 12, color: c.hint }}>{a.serial || "—"}</span></td>
                    <td style={{ ...td2, color: c.muted }}>{a.rating || "—"}</td>
                    <td style={td2}><OpenLink href={ROUTES.asset(a.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* QUOTATIONS TAB                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {activeTab === "quotations" && (
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionHead
              label="Quotations"
              count={hub.quotes.length}
              action={<AddLink href={ROUTES.quotationNew} label="New quotation" />}
            />
            {quotationTotal > 0 && (
              <div style={{ fontSize: 13, color: c.muted }}>
                Total pipeline: <strong style={{ color: c.ink }}>{fmtINR(quotationTotal)}</strong>
              </div>
            )}
          </div>
          {hub.quotes.length === 0 ? (
            <EmptyRow label="No quotations yet." href={ROUTES.quotationNew} linkLabel="Create first quotation" />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: c.panel2 }}>
                  <th style={th2}>Ref</th>
                  <th style={th2}>Status</th>
                  <th style={th2}>Amount</th>
                  <th style={th2}>Valid until</th>
                  <th style={th2}>Revision</th>
                  <th style={th2}></th>
                </tr>
              </thead>
              <tbody>
                {hub.quotes.map((q, i) => (
                  <tr key={q.id} style={{ borderTop: `1px solid ${c.line}`, background: i % 2 === 1 ? c.panel2 : "#fff" }}>
                    <td style={td2}><span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5, color: c.ink }}>{q.ref}</span></td>
                    <td style={td2}><Pill label={QUOTE_STATUS_LABEL[q.status]} tone={QUOTE_TONE[q.status] ?? "blue"} /></td>
                    <td style={td2}><span style={{ fontWeight: 600, color: c.ink }}>{fmtINR(q.total)}</span></td>
                    <td style={{ ...td2, color: c.hint, fontSize: 12 }}>{q.valid_until ? fmtDate(q.valid_until) : "—"}</td>
                    <td style={td2}>
                      {q.revision > 1
                        ? <span style={{ fontSize: 11.5, background: "#faeeda", color: "#633806", borderRadius: 4, padding: "2px 7px", fontWeight: 600 }}>Rev.{q.revision}</span>
                        : <span style={{ color: c.hint }}>—</span>}
                    </td>
                    <td style={td2}><OpenLink href={ROUTES.quotation(q.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* INVOICES TAB                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {activeTab === "invoices" && (
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionHead
              label="Invoices"
              count={hub.invoices.length}
              action={<AddLink href={ROUTES.invoiceNew} label="New invoice" />}
            />
            {invoiceBalance > 0 && (
              <div style={{ fontSize: 13, color: c.muted }}>
                Outstanding: <strong style={{ color: "#a32d2d" }}>{fmtINR(invoiceBalance)}</strong>
              </div>
            )}
          </div>
          {hub.invoices.length === 0 ? (
            <EmptyRow label="No invoices yet." href={ROUTES.invoiceNew} linkLabel="Create first invoice" />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: c.panel2 }}>
                  <th style={th2}>Ref</th>
                  <th style={th2}>Status</th>
                  <th style={th2}>Total</th>
                  <th style={th2}>Balance due</th>
                  <th style={th2}>Issued</th>
                  <th style={th2}></th>
                </tr>
              </thead>
              <tbody>
                {hub.invoices.map((inv, i) => (
                  <tr key={inv.id} style={{ borderTop: `1px solid ${c.line}`, background: i % 2 === 1 ? c.panel2 : "#fff" }}>
                    <td style={td2}><span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5, color: c.ink }}>{inv.ref}</span></td>
                    <td style={td2}><Pill label={INVOICE_LABEL[inv.status]} tone={INVOICE_TONE[inv.status]} /></td>
                    <td style={td2}><span style={{ fontWeight: 600, color: c.ink }}>{fmtINR(inv.total)}</span></td>
                    <td style={td2}>
                      <span style={{ fontWeight: 600, color: inv.total - inv.paid_amount > 0 ? "#a32d2d" : c.hint }}>
                        {fmtINR(Math.max(0, inv.total - inv.paid_amount))}
                      </span>
                    </td>
                    <td style={{ ...td2, color: c.hint, fontSize: 12 }}>{inv.issued_at ? fmtDate(inv.issued_at) : "—"}</td>
                    <td style={td2}><OpenLink href={ROUTES.invoice(inv.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* ACTIVITY TAB                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {activeTab === "activity" && (
        <section style={cardStyle}>
          <SectionHead label="Activity timeline" count={hub.activities.length} />
          {hub.activities.length === 0 ? (
            <div style={{ fontSize: 13, color: c.hint, textAlign: "center", padding: "32px 0" }}>No activity recorded yet</div>
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
                      <Pill label={act.pillar} tone={ACT_TONE[act.pillar]} />
                      <span style={{ color: c.hint, fontSize: 12 }}>{fmtDate(act.at)}</span>
                    </div>
                    <div style={{ marginTop: 5, color: c.ink, lineHeight: 1.5 }}>{act.text}</div>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}
    </>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────────

// Full-width tab tables
const th2: React.CSSProperties = {
  textAlign: "left", fontSize: 11.5, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.3, padding: "10px 16px",
  borderBottom: `1px solid ${c.line}`,
};
const td2: React.CSSProperties = {
  padding: "12px 16px", fontSize: 13.5, verticalAlign: "middle",
};
