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

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHead({
  icon, label, href, count, meta,
}: {
  icon: string; label: string; href: string; count?: number; meta?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: c.ink, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        {label}
        {count !== undefined && count > 0 && (
          <span style={{
            fontSize: 11, background: c.accentbg, color: c.accent,
            borderRadius: 4, padding: "1px 7px", fontWeight: 500,
          }}>
            {count}{meta ? " · " + meta : ""}
          </span>
        )}
      </h3>
      <Link href={href} style={{ fontSize: 11, color: c.accent, textDecoration: "none" }}>
        View all →
      </Link>
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const hub = await getAccountHubLive(id);
  if (!hub) notFound();

  const { referredBy } = hub;
  const account = hub.account as import("@/lib/types").Account;

  const openCases = hub.cases.filter(
    (sc) => !["closed", "buyback", "scrapped"].includes(sc.status)
  ).length;

  const quotationTotal = hub.quotes.reduce((s, q) => s + q.total, 0);
  const activeContracts = hub.contracts.filter((c) => c.status === "active").length;
  const activeWOs = hub.workOrders.filter(
    (wo) => wo.status === "in_progress" || wo.status === "scheduled"
  ).length;

  return (
    <>
      {/* ── Account header card ── */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ marginBottom: 10 }}>
          <Link href={ROUTES.accounts} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
            ← All accounts
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          {/* Left: name + type + city */}
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px", color: c.ink }}>
              {account.name}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />
              {account.city && (
                <span style={{ fontSize: 12.5, color: c.muted }}>📍 {account.city}</span>
              )}
              {referredBy && (
                <span style={{ fontSize: 12.5, color: c.muted }}>
                  via{" "}
                  <Link href={ROUTES.account(referredBy.id)} style={{ color: c.accent }}>
                    {referredBy.name}
                  </Link>
                </span>
              )}
            </div>
          </div>

          {/* Right: contact details */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: c.muted, textAlign: "right" }}>
            {account.phone && <span>📞 {account.phone}</span>}
            {account.email && (
              <a href={`mailto:${account.email}`} style={{ color: c.accent, textDecoration: "none" }}>
                ✉ {account.email}
              </a>
            )}
            <span>Since {fmtDate(account.created_at)}</span>
          </div>
        </div>

        {/* Summary row — plain text, no chips */}
        <div style={{
          borderTop: `1px solid ${c.line}`, marginTop: 12, paddingTop: 10,
          display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 12, color: c.muted,
        }}>
          {hub.contacts.length > 0 && (
            <span><strong style={{ color: c.ink }}>{hub.contacts.length}</strong> {hub.contacts.length === 1 ? "Contact" : "Contacts"}</span>
          )}
          {hub.cases.length > 0 && (
            <span>
              <strong style={{ color: c.ink }}>{hub.cases.length}</strong> Cases
              {openCases > 0 && <span style={{ color: c.accent }}> ({openCases} open)</span>}
            </span>
          )}
          {hub.quotes.length > 0 && (
            <span>
              <strong style={{ color: c.ink }}>{hub.quotes.length}</strong> Quotations
              {quotationTotal > 0 && <span> · {fmtINR(quotationTotal)}</span>}
            </span>
          )}
          {hub.contracts.length > 0 && (
            <span>
              <strong style={{ color: c.ink }}>{hub.contracts.length}</strong> AMC contracts
              {activeContracts > 0 && <span style={{ color: pillar.teal.base }}> ({activeContracts} active)</span>}
            </span>
          )}
          {hub.workOrders.length > 0 && (
            <span>
              <strong style={{ color: c.ink }}>{hub.workOrders.length}</strong> Work orders
              {activeWOs > 0 && <span style={{ color: pillar.amber.base }}> ({activeWOs} active)</span>}
            </span>
          )}
          {hub.assets.length > 0 && (
            <span><strong style={{ color: c.ink }}>{hub.assets.length}</strong> Assets</span>
          )}
          {hub.invoices.length > 0 && (
            <span><strong style={{ color: c.ink }}>{hub.invoices.length}</strong> Invoices</span>
          )}
        </div>
      </div>

      {/* ── Two-column grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 14 }} className="hub-grid">

        {/* ── LEFT: contacts + assets ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Contacts */}
          {hub.contacts.length > 0 && (
            <section style={cardStyle} id="contacts">
              <SectionHead icon="◉" label="Contacts" href={ROUTES.contacts} count={hub.contacts.length} />
              {hub.contacts.map((ct) => (
                <div key={ct.id} style={{ padding: "8px 0", borderTop: `1px solid ${c.line}` }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5, color: c.ink }}>{ct.name}</div>
                  <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{ct.role}</div>
                  <div style={{ fontSize: 11, color: c.hint, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {ct.phone && <span>📞 {ct.phone}</span>}
                    {ct.email && (
                      <a href={`mailto:${ct.email}`} style={{ color: c.accent, textDecoration: "none" }}>
                        {ct.email}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Assets */}
          {hub.assets.length > 0 && (
            <section style={cardStyle}>
              <SectionHead icon="⚙" label="Assets" href={ROUTES.assets} count={hub.assets.length} />
              {hub.assets.map((a) => (
                <RecordRow key={a.id}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: pillar.green.bg, color: pillar.green.fg,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                  }}>⚙</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {a.name}
                    </div>
                    <div style={{ fontSize: 11, color: c.muted, marginTop: 1 }}>
                      {a.kind}{a.rating ? " · " + a.rating : ""}{a.serial ? " · " + a.serial : ""}
                    </div>
                  </div>
                </RecordRow>
              ))}
            </section>
          )}
        </div>

        {/* ── RIGHT: cases, quotations, AMC contracts, work orders, invoices ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Cases */}
          {hub.cases.length > 0 && (
            <section style={cardStyle}>
              <SectionHead
                icon="☎" label="Cases" href={ROUTES.cases}
                count={hub.cases.length}
                meta={openCases > 0 ? `${openCases} open` : undefined}
              />
              {hub.cases.map((sc) => (
                <RecordRow key={sc.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{sc.ref}</span>
                      <Pill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} />
                      <Pill label={CASE_TYPE_LABEL[sc.type]} tone="blue" />
                    </div>
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {sc.equipment_label}
                    </div>
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sc.complaint}
                    </div>
                  </div>
                  <OpenLink href={ROUTES.case(sc.id)} />
                </RecordRow>
              ))}
            </section>
          )}

          {/* Quotations */}
          {hub.quotes.length > 0 && (
            <section style={cardStyle}>
              <SectionHead
                icon="₹" label="Quotations" href={ROUTES.quotations}
                count={hub.quotes.length}
                meta={quotationTotal > 0 ? fmtINR(quotationTotal) : undefined}
              />
              {hub.quotes.map((q) => (
                <RecordRow key={q.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{q.ref}</span>
                      <Pill label={QUOTE_STATUS_LABEL[q.status]} tone={QUOTE_TONE[q.status] ?? "blue"} />
                      {q.revision > 1 && (
                        <span style={{ fontSize: 10, background: "#faeeda", color: "#633806", borderRadius: 5, padding: "1px 6px" }}>
                          Rev.{q.revision}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3, display: "flex", gap: 12 }}>
                      <span style={{ fontWeight: 600, color: c.ink }}>{fmtINR(q.total)}</span>
                      {q.valid_until && <span>Valid until {fmtDate(q.valid_until)}</span>}
                    </div>
                  </div>
                  <OpenLink href={ROUTES.quotation(q.id)} />
                </RecordRow>
              ))}
            </section>
          )}

          {/* AMC contracts */}
          {hub.contracts.length > 0 && (
            <section style={cardStyle}>
              <SectionHead
                icon="▥" label="AMC contracts" href={ROUTES.amc}
                count={hub.contracts.length}
                meta={activeContracts > 0 ? `${activeContracts} active` : undefined}
              />
              {hub.contracts.map((ctr) => (
                <RecordRow key={ctr.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{ctr.ref}</span>
                      <Pill label={ctr.status} tone={CONTRACT_TONE[ctr.status] ?? "blue"} />
                    </div>
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {ctr.value != null && <span style={{ fontWeight: 600, color: c.ink }}>{fmtINR(ctr.value)}</span>}
                      {ctr.start_date && ctr.end_date && (
                        <span>{fmtDate(ctr.start_date)} → {fmtDate(ctr.end_date)}</span>
                      )}
                    </div>
                  </div>
                  <OpenLink href={ROUTES.amc} />
                </RecordRow>
              ))}
            </section>
          )}

          {/* Work orders */}
          {hub.workOrders.length > 0 && (
            <section style={cardStyle}>
              <SectionHead
                icon="▤" label="Work orders" href={ROUTES.workOrders}
                count={hub.workOrders.length}
                meta={activeWOs > 0 ? `${activeWOs} active` : undefined}
              />
              {hub.workOrders.map((wo) => {
                const auth = wo.authorized_by.kind === "quote"
                  ? { label: "Quotation", tone: "blue" as PillarKey }
                  : { label: "AMC contract", tone: "teal" as PillarKey };
                return (
                  <RecordRow key={wo.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{wo.ref}</span>
                        <Pill label={wo.status.replace("_", " ")} tone={WO_TONE[wo.status] ?? "blue"} />
                        <Pill label={auth.label} tone={auth.tone} />
                      </div>
                      <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3, display: "flex", gap: 8 }}>
                        {wo.asset && <span>{wo.asset.name}</span>}
                        {wo.technician && <span>· {wo.technician.name}</span>}
                        {wo.scheduled_for && <span>· {fmtDate(wo.scheduled_for)}</span>}
                      </div>
                    </div>
                    <OpenLink href={ROUTES.workOrders} />
                  </RecordRow>
                );
              })}
            </section>
          )}

          {/* Invoices */}
          {hub.invoices.length > 0 && (
            <section style={cardStyle}>
              <SectionHead icon="⊟" label="Invoices" href={ROUTES.invoices} count={hub.invoices.length} />
              {hub.invoices.map((inv) => (
                <RecordRow key={inv.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{inv.ref}</span>
                      <Pill
                        label={inv.status}
                        tone={inv.status === "paid" ? "green" : inv.status === "overdue" ? "red" : inv.status === "sent" ? "amber" : "blue"}
                      />
                    </div>
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 3, display: "flex", gap: 12 }}>
                      {inv.total > 0 && <span style={{ fontWeight: 600, color: c.ink }}>{fmtINR(inv.total)}</span>}
                      {inv.issued_at && <span>Issued {fmtDate(inv.issued_at)}</span>}
                    </div>
                  </div>
                  <OpenLink href={ROUTES.invoices} />
                </RecordRow>
              ))}
            </section>
          )}
        </div>
      </div>

      {/* ── Timeline (full width below) ── */}
      {hub.activities.length > 0 && (
        <section style={{ ...cardStyle, marginTop: 14 }}>
          <h3 style={{ fontSize: 13, margin: "0 0 14px", fontWeight: 600 }}>Activity timeline</h3>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {hub.activities.map((act, i) => {
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
            })}
          </div>
        </section>
      )}
    </>
  );
}
