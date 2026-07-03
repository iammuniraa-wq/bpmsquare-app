import Link from "next/link";
import { listContacts, ACCOUNT_TYPE_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ComingSoon from "@/components/ComingSoon";
import ViewToggle from "@/components/ViewToggle";
import { ROUTES } from "@/lib/constants";
import type { Account } from "@/lib/types";
import { Phone, Mail } from "@/components/Icons";

const TYPE_TONE: Record<Account["type"], PillarKey> = {
  prospect:     "amber",
  oem:          "purple",
  direct:       "blue",
  end_customer: "teal",
};

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const isCard = view !== "list";
  const rows = await listContacts();

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${rows.length} people across all accounts`}
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              href={ROUTES.contactNew}
              style={{
                padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                background: c.accent, color: "#fff", textDecoration: "none",
              }}
            >
              + New Contact
            </Link>
            <ViewToggle />
          </div>
        }
      />

      {isCard ? (
        // ── Card grid ──────────────────────────────────────────────────────────
        <div className="card-grid">
          {rows.map(({ contact, account }) => {
            const tone = TYPE_TONE[account.type];
            const p = pillar[tone];
            return (
              <div
                key={contact.id}
                style={{
                  ...cardStyle,
                  display: "flex", flexDirection: "column", gap: 10,
                }}
              >
                {/* Avatar + account pill */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                    background: p.bg, color: p.fg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
                  }}>
                    {initials(contact.name)}
                  </div>
                  <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={tone} />
                </div>

                {/* Name + role */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>{contact.name}</div>
                  {contact.role && (
                    <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{contact.role}</div>
                  )}
                  <Link
                    href={ROUTES.account(account.id)}
                    style={{ fontSize: 12, color: c.accent, textDecoration: "none", fontWeight: 500, marginTop: 4, display: "inline-block" }}
                  >
                    {account.name}
                  </Link>
                </div>

                {/* Contact info */}
                <div style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${c.line}`, display: "flex", flexDirection: "column", gap: 3 }}>
                  {contact.phone && (
                    <span style={{ fontSize: 12, color: c.muted, display: "flex", alignItems: "center", gap: 4 }}><Phone size={11} color={c.hint} /> {contact.phone}</span>
                  )}
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} style={{ fontSize: 12, color: c.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                      <Mail size={11} color={c.accent} /> {contact.email}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // ── List view ──────────────────────────────────────────────────────────
        <section style={cardStyle}>
          {rows.length === 0 ? (
            <p style={{ color: c.muted, fontSize: 13, margin: 0 }}>No contacts yet.</p>
          ) : (
            rows.map(({ contact, account }, i) => (
              <div
                key={contact.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 0",
                  borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
                  flexWrap: "wrap",
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                  background: pillar.blue.bg, color: pillar.blue.fg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
                }}>
                  {initials(contact.name)}
                </div>

                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{contact.name}</div>
                  {contact.role && (
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 1 }}>{contact.role}</div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                    <Link href={ROUTES.account(account.id)} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 500 }}>
                      {account.name}
                    </Link>
                    <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: c.muted, minWidth: 160 }}>
                  {contact.phone && <span>{contact.phone}</span>}
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} style={{ color: c.accent, textDecoration: "none" }}>{contact.email}</a>
                  )}
                </div>

                <div className="contact-actions" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#f0faf5", color: "#3d7a5a", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 500, cursor: "not-allowed", whiteSpace: "nowrap" }}>
                    WhatsApp <ComingSoon size="xs" />
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: c.panel2, color: c.hint, borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 500, cursor: "not-allowed", whiteSpace: "nowrap" }}>
                    Email <ComingSoon size="xs" />
                  </span>
                </div>
              </div>
            ))
          )}
        </section>
      )}
    </>
  );
}
