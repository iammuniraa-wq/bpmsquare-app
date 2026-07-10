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
import type { Activity, Account } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import CustomFieldsSection from "@/components/CustomFieldsSection";
import { MapPin, Phone, Mail, Gear } from "@/components/Icons";
import AccountEditPanel from "./AccountEditPanel";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

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

type Tab = "overview" | "cases" | "contacts" | "assets" | "quotations" | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview",   label: "Overview"   },
  { id: "cases",      label: "Cases"      },
  { id: "contacts",   label: "Contacts"   },
  { id: "assets",     label: "Assets"     },
  { id: "quotations", label: "Quotations" },
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

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      gap: 10, padding: "8px 0", borderTop: `1px solid ${c.line}`, fontSize: 13,
    }}>
      <span style={{ color: c.hint, flexShrink: 0, fontSize: 12 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.ink, fontWeight: 500 }}>{children}</span>
    </div>
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

  const openCases      = hub.cases.filter((sc) => !["closed", "buyback", "scrapped"].includes(sc.status));
  const closedCases    = hub.cases.filter((sc) =>  ["closed", "buyback", "scrapped"].includes(sc.status));
  const quotationTotal = hub.quotes.reduce((s, q) => s + q.total, 0);

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
      <div style={{ ...cardStyle, marginBottom: 2, padding: "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
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

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <AccountEditPanel account={account} />
            <AdaptObjectDrawer
              objectType="account"
              objectLabel="Account"
              isAdmin={role === "admin"}
            />
          </div>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: `1px solid ${c.line}`, overflowX: "auto" }}>
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
        <div className="hub-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,300px) minmax(0,1fr)", gap: 14, alignItems: "start" }}>

          {/* LEFT: Account details */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            <section style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                Account details
              </div>
              <DetailRow label="Type">
                <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />
              </DetailRow>
              {account.city  && <DetailRow label="City">{account.city}</DetailRow>}
              {account.phone && (
                <DetailRow label="Phone">
                  <a href={`tel:${account.phone}`} style={{ color: c.accent, textDecoration: "none" }}>{account.phone}</a>
                </DetailRow>
              )}
              {account.email && (
                <DetailRow label="Email">
                  <a href={`mailto:${account.email}`} style={{ color: c.accent, textDecoration: "none", wordBreak: "break-all" }}>{account.email}</a>
                </DetailRow>
              )}
              {referredBy && (
                <DetailRow label="Via OEM">
                  <Link href={ROUTES.account(referredBy.id)} style={{ color: c.accent, textDecoration: "none" }}>{referredBy.name}</Link>
                </DetailRow>
              )}
              <DetailRow label="Customer since">{fmtDate(account.created_at)}</DetailRow>
              <div style={{ marginTop: 10 }}>
                <CustomFieldsSection
                  objectType="account"
                  recordId={account.id}
                  customData={(account as Record<string, unknown>).custom_data as Record<string, unknown> | null}
                  patchUrl={`/api/accounts/${account.id}`}
                />
              </div>
            </section>

            {/* Contacts sidebar */}
            <section style={cardStyle}>
              <SectionHead
                label="Contacts"
                count={hub.contacts.length}
                action={<AddLink href={`${ROUTES.contactNew}?account_id=${id}`} label="Add" />}
              />
              {hub.contacts.length === 0 ? (
                <div style={{ fontSize: 12.5, color: c.hint, padding: "8px 0" }}>No contacts yet</div>
              ) : (
                hub.contacts.slice(0, 5).map((ct, i) => (
                  <div key={ct.id} style={{ paddingTop: 10, borderTop: `1px solid ${c.line}` }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{ct.name}</div>
                        {ct.role && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 1 }}>{ct.role}</div>}
                      </div>
                      <OpenLink href={ROUTES.contact(ct.id)} />
                    </div>
                    <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
                      {ct.phone && (
                        <a href={`tel:${ct.phone}`} style={{ fontSize: 12.5, color: c.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
                          <Phone size={12} color={c.accent} /> {ct.phone}
                        </a>
                      )}
                      {ct.email && (
                        <a href={`mailto:${ct.email}`} style={{ fontSize: 12, color: c.muted, textDecoration: "none", display: "flex", alignItems: "center", gap: 5, wordBreak: "break-all" }}>
                          <Mail size={12} color={c.hint} /> {ct.email}
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
              {hub.contacts.length > 5 && (
                <Link href={tabHref("contacts")} style={{ display: "block", textAlign: "center", marginTop: 12, fontSize: 12.5, color: c.accent, textDecoration: "none" }}>
                  See all {hub.contacts.length} contacts →
                </Link>
              )}
            </section>
          </div>

          {/* RIGHT: Open cases — the single most actionable view */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <section style={cardStyle}>
              <SectionHead
                label="Open cases"
                count={openCases.length}
                action={<AddLink href={`${ROUTES.caseNew}?account_id=${id}`} label="New case" />}
              />

              {openCases.length === 0 ? (
                <EmptyRow label="No open cases for this account." href={`${ROUTES.caseNew}?account_id=${id}`} linkLabel="Create first case" />
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                      <th style={cth}>Ref</th>
                      <th style={cth}>Equipment</th>
                      <th style={cth}>Stage</th>
                      <th style={cth}>Type</th>
                      <th style={cth}>Intake</th>
                      <th style={cth}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {openCases.map((sc) => (
                      <tr key={sc.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                        <td style={ctd}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5, color: c.ink }}>{sc.ref}</span>
                        </td>
                        <td style={ctd}>
                          <div style={{ fontWeight: 500, fontSize: 13, color: c.ink }}>{sc.equipment_label || "—"}</div>
                          {sc.complaint && (
                            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                              {sc.complaint}
                            </div>
                          )}
                        </td>
                        <td style={ctd}><Pill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} /></td>
                        <td style={ctd}><Pill label={CASE_TYPE_LABEL[sc.type]} tone="blue" /></td>
                        <td style={{ ...ctd, color: c.hint, fontSize: 12 }}>{fmtDate(sc.intake_at)}</td>
                        <td style={ctd}><OpenLink href={ROUTES.case(sc.id)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {closedCases.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
                  <Link href={tabHref("cases")} style={{ fontSize: 12.5, color: c.muted, textDecoration: "none" }}>
                    + {closedCases.length} closed case{closedCases.length !== 1 ? "s" : ""} — view all →
                  </Link>
                </div>
              )}
            </section>

            {/* Compact: Assets + recent quotes side by side */}
            {(hub.assets.length > 0 || hub.quotes.length > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {hub.assets.length > 0 && (
                  <section style={cardStyle}>
                    <SectionHead label="Assets" count={hub.assets.length} action={<AddLink href={`${ROUTES.assetNew}?account_id=${id}`} label="Add" />} />
                    {hub.assets.slice(0, 4).map((a) => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${c.line}` }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, background: pillar.green.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Gear size={13} color={pillar.green.fg} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                          <div style={{ fontSize: 11, color: c.hint, textTransform: "capitalize" }}>{a.kind}{a.make ? ` · ${a.make}` : ""}</div>
                        </div>
                        <OpenLink href={ROUTES.asset(a.id)} />
                      </div>
                    ))}
                    {hub.assets.length > 4 && (
                      <Link href={tabHref("assets")} style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                        See all {hub.assets.length} →
                      </Link>
                    )}
                  </section>
                )}

                {hub.quotes.length > 0 && (
                  <section style={cardStyle}>
                    <SectionHead label="Quotations" count={hub.quotes.length} action={<AddLink href={ROUTES.quotationNew} label="New" />} />
                    {hub.quotes.slice(0, 4).map((q) => (
                      <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${c.line}` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 12, color: c.ink }}>{q.ref}</span>
                            <Pill label={QUOTE_STATUS_LABEL[q.status]} tone={QUOTE_TONE[q.status] ?? "blue"} />
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: c.ink, marginTop: 2 }}>{fmtINR(q.total)}</div>
                        </div>
                        <OpenLink href={ROUTES.quotation(q.id)} />
                      </div>
                    ))}
                    {hub.quotes.length > 4 && (
                      <Link href={tabHref("quotations")} style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12, color: c.accent, textDecoration: "none" }}>
                        See all {hub.quotes.length} →
                      </Link>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
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

// Case table inside overview
const cth: React.CSSProperties = {
  textAlign: "left", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.4, padding: "8px 12px",
};
const ctd: React.CSSProperties = {
  padding: "10px 12px", fontSize: 13, verticalAlign: "middle",
};

// Full-width tab tables
const th2: React.CSSProperties = {
  textAlign: "left", fontSize: 11.5, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.3, padding: "10px 16px",
  borderBottom: `1px solid ${c.line}`,
};
const td2: React.CSSProperties = {
  padding: "12px 16px", fontSize: 13.5, verticalAlign: "middle",
};
