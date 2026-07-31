"use client";

import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { useUserRole } from "@/lib/tenant-context";

// ── Settings hub — a menu of destinations, not a growing list of tabs ───────
//
// Each entry is its own full page (see the corresponding route). Grouped the
// same way the app already groups everything else (Sales/Service pillars),
// so this reads as an extension of the product, not a bolted-on admin panel.

type SettingsCard = {
  label: string;
  description: string;
  href: string;
  icon: string;
  pillarKey: PillarKey;
  adminOnly: boolean;
};

const SECTIONS: { group: string; items: SettingsCard[] }[] = [
  {
    group: "Workspace",
    items: [
      { label: "General settings", description: "Navigation, appearance, workspace name, integrations, developer API", href: ROUTES.settingsGeneral, icon: "◈", pillarKey: "blue", adminOnly: false },
      { label: "Team", description: "Invite teammates and manage roles", href: ROUTES.settingsTeam, icon: "◉", pillarKey: "blue", adminOnly: true },
    ],
  },
  {
    group: "Sales & service setup",
    items: [
      { label: "Entities & Tax", description: "Legal entities, print branding, and tax settings for quotations and PDFs", href: ROUTES.settingsEntities, icon: "⌂", pillarKey: "teal", adminOnly: true },
      { label: "Statuses & assets", description: "Configure pipeline stages and equipment print fields", href: ROUTES.settingsStatuses, icon: "▦", pillarKey: "teal", adminOnly: true },
      { label: "Sales config", description: "Manage territory and sales org picklist values", href: ROUTES.settingsSales, icon: "▤", pillarKey: "teal", adminOnly: true },
    ],
  },
  {
    group: "Content & data",
    items: [
      { label: "Email templates", description: "Subject and body pairs your team can pick between when emailing a quote", href: ROUTES.settingsEmailTemplates, icon: "✉", pillarKey: "purple", adminOnly: true },
      { label: "Pricing catalogue", description: "Standard rates for labour, materials, testing and transport", href: ROUTES.configPricing, icon: "₹", pillarKey: "amber", adminOnly: false },
      { label: "Text templates", description: "Saved snippets for line items, notes and terms", href: ROUTES.configTemplates, icon: "❑", pillarKey: "amber", adminOnly: false },
      { label: "Custom fields", description: "Add fields to any object — included automatically in the API and MCP", href: ROUTES.configCustomFields, icon: "✦", pillarKey: "amber", adminOnly: false },
      { label: "Deleted records", description: "Audit log of permanently deleted objects", href: ROUTES.settingsDeletionLog, icon: "⌫", pillarKey: "red", adminOnly: true },
    ],
  },
];

function SettingsTile({ item }: { item: SettingsCard }) {
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

export default function SettingsHubPage() {
  const role = useUserRole();
  const isAdmin = role === "admin";

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 19, margin: 0, fontWeight: 600 }}>Settings</h1>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: c.muted }}>
          Configure your workspace, sales &amp; service setup, and data.
        </p>
      </div>

      {SECTIONS.map((section) => {
        const items = section.items.filter((i) => !i.adminOnly || isAdmin);
        if (items.length === 0) return null;
        return (
          <div key={section.group} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
              {section.group}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
              {items.map((item) => <SettingsTile key={item.href} item={item} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
