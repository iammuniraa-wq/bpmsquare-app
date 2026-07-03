import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactLive } from "@/lib/data/live";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";

const CASE_TONE: Record<string, PillarKey> = {
  intake: "blue", inspection: "teal",
  report_sent: "amber", report_approved: "green",
  quote_sent: "amber", quote_approved: "green",
  in_repair: "amber", qa: "teal",
  ready: "green", closed: "green",
  buyback: "purple", scrapped: "red",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getContactLive(id);
  if (!data) notFound();
  const { contact, account, cases } = data;

  const openCases = cases.filter((c) => !["closed", "buyback", "scrapped"].includes(c.status));

  return (
    <>
      <TabTitle title={contact.name} />

      {/* Header */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ marginBottom: 10 }}>
          <Link href={ROUTES.contacts} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
            ← All contacts
          </Link>
          {account && (
            <>
              <span style={{ fontSize: 12, color: c.hint, margin: "0 6px" }}>/</span>
              <Link href={ROUTES.account(account.id)} style={{ fontSize: 12, color: c.accent, textDecoration: "none" }}>
                {account.name}
              </Link>
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: c.ink }}>{contact.name}</h1>
            {contact.role && <div style={{ fontSize: 13, color: c.muted }}>{contact.role}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: c.muted, textAlign: "right" }}>
            {contact.phone && <span>📞 {contact.phone}</span>}
            {contact.email && (
              <a href={`mailto:${contact.email}`} style={{ color: c.accent, textDecoration: "none" }}>✉ {contact.email}</a>
            )}
          </div>
        </div>

        {account && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.line}`, fontSize: 12.5, color: c.muted }}>
            Account:{" "}
            <Link href={ROUTES.account(account.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
              {account.name}
            </Link>
            {account.city && <span style={{ marginLeft: 8 }}>📍 {account.city}</span>}
          </div>
        )}
      </div>

      {/* Cases */}
      {cases.length > 0 && (
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: c.ink }}>
              Cases
              <span style={{ marginLeft: 8, fontSize: 11, background: c.accentbg, color: c.accent, borderRadius: 4, padding: "1px 7px" }}>
                {cases.length}{openCases.length > 0 ? ` · ${openCases.length} open` : ""}
              </span>
            </h3>
            <Link href={`${ROUTES.caseNew}?account_id=${account?.id ?? ""}`}
              style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, borderRadius: 6, padding: "4px 10px", textDecoration: "none" }}>
              + New case
            </Link>
          </div>
          {cases.map((sc) => (
            <div key={sc.id} style={{ padding: "9px 0", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{sc.ref}</span>
                  <Pill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} />
                  <Pill label={CASE_TYPE_LABEL[sc.type]} tone="blue" />
                </div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{sc.equipment_label}</div>
                <div style={{ fontSize: 11, color: c.hint, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sc.complaint}</div>
                <div style={{ fontSize: 10.5, color: c.hint, marginTop: 1 }}>{fmtDate(sc.intake_at)}</div>
              </div>
              <Link href={ROUTES.case(sc.id)} style={{ fontSize: 11, fontWeight: 600, color: c.accent, background: c.accentbg, borderRadius: 6, padding: "3px 8px", textDecoration: "none", flexShrink: 0 }}>
                Open →
              </Link>
            </div>
          ))}
        </section>
      )}

      {cases.length === 0 && (
        <div style={{ ...cardStyle, textAlign: "center", padding: "32px 16px", color: c.hint, fontSize: 13 }}>
          No cases linked to this contact yet.
          {account && (
            <div style={{ marginTop: 10 }}>
              <Link href={`${ROUTES.caseNew}?account_id=${account.id}`}
                style={{ fontSize: 13, fontWeight: 600, color: c.accent, textDecoration: "none" }}>
                + Create first case →
              </Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}
