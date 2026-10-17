"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NAV, type NavItem } from "@/lib/constants";
import { navState, toggleNavItem } from "@/lib/navVisibility";
import { c } from "@/lib/theme";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import Pager from "@/components/Pager";
import { PILLAR_DOT, Section, Toggle, useSavedFlash } from "@/components/settings/generalShared";

export default function NavigationVisibilityPage() {
  const router = useRouter();
  const { settings } = useSettings();
  const tenant = useTenant();
  const tenantFeatures = tenant?.features as Record<string, boolean> | undefined;
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const [saved, flashSaved] = useSavedFlash();

  // Only show nav items whose feature is enabled at the tenant (platform admin) level.
  // If platform admin turns off a feature, local admin cannot see or re-enable it here.
  // Flattens children too (e.g. Quotations/Standard Quotes/Pipeline/Invoices under the
  // "Sales" parent) -- each gets its own row and its own toggle, keyed by its own href
  // in the same nav_hidden_hrefs array a parent-level toggle already uses. Previously
  // only top-level items were listed here, so there was no way to hide just one child
  // while keeping its siblings visible; hiding the parent hid all of them together.
  const allNavItems = NAV.flatMap((grp) =>
    grp.items
      .filter((item) => !item.adminOnly && (!item.featureKey || tenantFeatures?.[item.featureKey] === true))
      .flatMap((item) => {
        const parentRow = { ...item, group: grp.group, sub: null as string | null, indent: false };
        if (!item.children?.length) return [parentRow];
        const childRows = item.children
          .filter((ch) => !ch.featureKey || tenantFeatures?.[ch.featureKey] === true)
          .map((ch) => ({ ...ch, group: grp.group, sub: item.label, indent: true }));
        // A bundled parent (Sales, Service, …) has no featureKey of its own --
        // when every child is feature-filtered out, drop the parent row too
        // instead of offering a toggle for an empty ghost group.
        if (childRows.length === 0) return [];
        return [parentRow, ...childRows];
      })
  );

  // Grouped by NAV section (owner-flagged 2026-08-25: one long flat list was
  // hard to scan) -- same top-level names the sidebar itself uses. Paginated
  // by SECTION, not by row: a section's toggles all stay together on one
  // page rather than a group getting split mid-way.
  const navGroups: { group: string; items: typeof allNavItems }[] = [];
  for (const item of allNavItems) {
    const last = navGroups[navGroups.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else navGroups.push({ group: item.group, items: [item] });
  }
  const NAV_GROUPS_PER_PAGE = 3;
  const [navGroupPage, setNavGroupPage] = useState(1);
  const navPageStart = (navGroupPage - 1) * NAV_GROUPS_PER_PAGE;
  const navGroupsOnPage = navGroups.slice(navPageStart, navPageStart + NAV_GROUPS_PER_PAGE);

  // ── Navigation visibility — tenant-wide (tenants.config), not per-browser ──
  const [navSaving, setNavSaving] = useState(false);
  const [navError, setNavError] = useState("");
  const [storedHidden, setStoredHidden] = useState<string[]>(() => tenant?.config?.nav_hidden_hrefs ?? []);
  const [navHidden, setNavHidden] = useState<string[]>(storedHidden);
  const navDirty = [...navHidden].sort().join("|") !== [...storedHidden].sort().join("|");
  // Only the children this workspace has count toward a parent's state.
  const hasChild = (ch: NavItem) => !ch.featureKey || tenantFeatures?.[ch.featureKey] === true;

  const toggleRow = (item: { href: string; children?: NavItem[] }) => {
    setNavHidden(toggleNavItem(navHidden, item, hasChild));
  };

  const saveNav = async () => {
    setNavSaving(true);
    setNavError("");
    const res = await fetch("/api/settings/entities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nav_hidden_hrefs: navHidden }),
    }).catch(() => null);
    setNavSaving(false);
    if (!res) { setNavError("Network error"); return; }
    if (!res.ok) { setNavError((await res.json().catch(() => ({}))).error ?? "Could not save"); return; }
    setStoredHidden(navHidden);
    flashSaved();
    router.refresh();
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Navigation visibility" subtitle="Show or hide sidebar items for the whole workspace — every user, every device." />
      <SettingsSave dirty={navDirty} saving={navSaving} saved={saved} error={navError} onSave={saveNav} />

      <Section
        id="nav"
        title=""
        description="Toggle sidebar items on or off for the whole workspace — every user, every device. Hidden items are still reachable by URL."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {navGroupsOnPage.map((grp) => (
            <div key={grp.group}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
                {grp.group}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {grp.items.map((item, idx) => {
                  const state = navState(navHidden, item, hasChild);
                  const visible = state !== "off";
                  return (
                    <div key={`${item.indent ? "child" : "row"}:${item.href}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", paddingLeft: item.indent ? 28 : 4, borderTop: idx > 0 ? `1px solid ${c.line}` : "none", opacity: visible ? 1 : 0.4, transition: "opacity 0.15s" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: PILLAR_DOT[item.pillar] ?? "#378ADD" }} />
                      <span style={{ fontSize: 16, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>{item.label}</div>
                        {item.sub && <div style={{ fontSize: 11, color: c.hint }}>{item.sub}</div>}
                        {state === "mixed" && <div style={{ fontSize: 11, color: c.hint }}>Some hidden</div>}
                      </div>
                      <Toggle on={visible} label={item.label} onChange={() => toggleRow(item)} accent={accent} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <Pager page={navGroupPage} total={navGroups.length} pageSize={NAV_GROUPS_PER_PAGE} onPage={setNavGroupPage} />
      </Section>
    </div>
  );
}
