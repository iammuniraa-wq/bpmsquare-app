import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactLive } from "@/lib/data/live";
import { getUserRole } from "@/lib/tenant";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import { Phone, Mail, MapPin } from "@/components/Icons";
import ContactEditPanel from "./ContactEditPanel";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import CustomFieldsSection from "@/components/CustomFieldsSection";

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Plain date strings (no time component) are formatted without going through
// Date(), which would otherwise shift the day depending on the viewer's timezone.
const fmtPlainDate = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
};

function DetailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
        {label}
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: c.accent, textDecoration: "none", wordBreak: "break-word" }}>
          {value}
        </a>
      ) : (
        <div style={{ fontSize: 13, color: c.ink, wordBreak: "break-word" }}>{value}</div>
      )}
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [data, role] = await Promise.all([getContactLive(id), getUserRole()]);
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
            {contact.phone && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Phone size={12} color={c.hint} /> {contact.phone}</span>}
            {contact.email && (
              <a href={`mailto:${contact.email}`} style={{ color: c.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}><Mail size={12} color={c.accent} /> {contact.email}</a>
            )}
          </div>
        </div>

        {account && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.line}`, fontSize: 12.5, color: c.muted }}>
            Account:{" "}
            <Link href={ROUTES.account(account.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
              {account.name}
            </Link>
            {account.city && <span style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 4 }}><MapPin size={11} color={c.hint} /> {account.city}</span>}
          </div>
        )}

        <div style={{ marginTop: account ? 10 : 12, display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <ContactEditPanel contact={contact} accountAddress={account ?? null} />
          <AdaptObjectDrawer
            objectType="contact"
            objectLabel="Contact"
            isAdmin={role === "admin"}
          />
        </div>
      </div>

      {/* Details — every populated field, not just the header basics */}
      {(contact.department || contact.birthday || contact.linkedin_url || contact.phone2 || contact.phone3 ||
        contact.email2 || contact.website || contact.address_line1 || contact.city ||
        contact.territory || contact.sales_org || contact.notes) && (
        <section style={{ ...cardStyle, marginBottom: 14 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Details
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px 20px" }}>
            {contact.department && <DetailRow label="Department" value={contact.department} />}
            {contact.birthday && <DetailRow label="Birthday" value={fmtPlainDate(contact.birthday)} />}
            {contact.linkedin_url && <DetailRow label="LinkedIn" value={contact.linkedin_url} href={contact.linkedin_url} />}
            {contact.phone2 && <DetailRow label="Secondary phone" value={contact.phone2} />}
            {contact.phone3 && <DetailRow label="Third phone" value={contact.phone3} />}
            {contact.email2 && <DetailRow label="Secondary email" value={contact.email2} href={`mailto:${contact.email2}`} />}
            {contact.website && <DetailRow label="Website" value={contact.website} href={contact.website.startsWith("http") ? contact.website : `https://${contact.website}`} />}
            {(contact.territory || contact.sales_org) && (
              <DetailRow label="Territory / sales org" value={[contact.territory, contact.sales_org].filter(Boolean).join(" · ")} />
            )}
            {(contact.address_line1 || contact.city) && (
              <DetailRow
                label="Address"
                value={[contact.address_line1, contact.address_line2, contact.city, contact.state, contact.postal_code, contact.country]
                  .filter(Boolean).join(", ")}
              />
            )}
          </div>
          {contact.notes && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                Notes
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: c.ink }}>{contact.notes}</p>
            </div>
          )}
        </section>
      )}

      {/* Custom fields */}
      <CustomFieldsSection
        objectType="contact"
        recordId={contact.id}
        customData={(contact as Record<string, unknown>).custom_data as Record<string, unknown> | null}
        patchUrl={`/api/contacts/${contact.id}`}
      />

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
