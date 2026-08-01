import { redirect } from "next/navigation";
import Link from "next/link";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";

// Administrator — a home for audit/operations tooling that doesn't belong in
// Settings (which is tenant configuration: fields, statuses, templates) or
// in Data Workbench (bulk import/export of business records). Same
// menu-of-destinations shape as the Settings hub, deliberately, so this
// reads as an extension of the product rather than a bolted-on panel. Grows
// here as more audit/ops surfaces ship (outbound email log, etc.) instead of
// piling into Settings.

type AdminCard = { label: string; description: string; href: string; icon: string; pillarKey: PillarKey };

const SECTIONS: { group: string; items: AdminCard[] }[] = [
  {
    group: "Audit",
    items: [
      { label: "Change History", description: "Every create, update, and delete across your records — who, when, and what changed", href: ROUTES.administrationChangeHistory, icon: "🕘", pillarKey: "teal" },
      { label: "Outbound Emails", description: "Every quote email and campaign send — recipient, subject, and whether it succeeded", href: ROUTES.administrationOutboundEmails, icon: "✉️", pillarKey: "blue" },
    ],
  },
];

function AdminTile({ item }: { item: AdminCard }) {
  const p = pillar[item.pillarKey];
  return (
    <Link
      href={item.href}
      className="modern-lift"
      style={{
        ...cardStyle,
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: 16, textDecoration: "none", color: "inherit",
        cursor: "pointer",
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: p.bg, color: p.fg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16,
      }}>
        {item.icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: c.ink }}>{item.label}</span>
        <span style={{ display: "block", fontSize: 11.5, color: c.muted, marginTop: 3, lineHeight: 1.45 }}>{item.description}</span>
      </span>
    </Link>
  );
}

export default async function AdministrationHubPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.dashboard);
  }
  if (role !== "admin") redirect(ROUTES.dashboard);

  return (
    <>
      <TabTitle title="Administrator" />
      <PageHeader title="Administrator" subtitle="Audit trails and operations tooling for your workspace" />
      <div style={{ maxWidth: 780 }}>
        {SECTIONS.map((section) => (
          <div key={section.group} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
              {section.group}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
              {section.items.map((item) => <AdminTile key={item.href} item={item} />)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
