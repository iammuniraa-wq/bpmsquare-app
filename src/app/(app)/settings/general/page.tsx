"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useFeel } from "@/components/FeelProvider";
import { useRouter } from "next/navigation";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import type { AccentPreset } from "@/lib/settings";
import { NAV, ROUTES, QUOTE_TYPES } from "@/lib/constants";
import type { QuoteTypeId, TenantConfig } from "@/lib/constants";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import EmailOutputSection from "./EmailOutputSection";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import { Mail, MessageSquare, LinkIcon, Globe, Phone, FileText, Wrench, BarChart2, Package, CalendarCheck, Zap } from "@/components/Icons";
import Pager from "@/components/Pager";
import ApiKeysPanel from "./ApiKeysPanel";
import WebhooksPanel from "./WebhooksPanel";

// Nova's own accent presets -- independent of ACCENT_PRESETS (classic/nextgen
// chrome). "Pink" (color: null) is Nova's shipped default -- it maps to no
// stored value at all, not a hardcoded hex, so a tenant that picks it back
// after trying another hue stays on Nova's true default rather than pinning
// today's hex forever.
const NOVA_ACCENT_PRESETS: { label: string; color: string | null }[] = [
  { label: "Pink (default)", color: null },
  { label: "Orange", color: "#FF6B35" },
  { label: "Purple", color: "#7B2FBE" },
  { label: "Teal", color: "#14C8B4" },
  { label: "Blue", color: "#3C82FF" },
];

const PILLAR_DOT: Record<string, string> = {
  blue: "#378ADD", purple: "var(--purple)", teal: "var(--teal)",
  amber: "#f6b23c", red: "var(--err-ink)", green: "#639922",
};

// ── Integration catalogue ─────────────────────────────────────────────────────

const INTEGRATIONS = [
  {
    icon: <Mail size={16} />, name: "Email — Resend",
    desc: "Send quotations and invoices directly from the system as PDF attachments, from your own sender identity",
    status: "active" as const,
    note: "Free tier: 3,000 emails/month · where mail is delivered is governed by Email output above · inspection reports not wired up yet",
  },
  {
    icon: <MessageSquare size={16} />, name: "WhatsApp (embedded)",
    desc: "Message contacts from cases, quotations and work orders via the Meta Business API — automated sends, delivery receipts, full inbox",
    status: "coming-soon" as const,
    note: "Meta Cloud API · 1,000 free conversations/month · recommended for India · a lighter-weight WhatsApp (external) option is already live on quotes and cases — opens a pre-filled wa.me chat for a rep to send manually",
  },
  {
    icon: <LinkIcon size={16} />, name: "Webhooks",
    desc: "Push real-time events to your systems when cases or quotations change status",
    status: "coming-soon" as const,
    note: "POST to any URL on: case.created, case.status_changed, quote.approved, invoice.sent",
  },
  {
    icon: <Globe size={16} />, name: "MCP Server",
    desc: "Allow any AI assistant to read and write CRM data via Model Context Protocol",
    status: "ready" as const,
    note: "Config at mcp-server/mcp.json · connect to Claude, Cursor, or any MCP-compatible client",
  },
  {
    icon: <Phone size={16} />, name: "PWA / Mobile app",
    desc: "Install on Android or iOS for field staff — the punch page works offline",
    status: "active" as const,
    note: "Add to Home Screen to install · a service worker caches the app shell so My Workforce loads and lets you punch with no network; punches queue and sync when back online",
  },
];

const API_ENDPOINTS = [
  { method: "GET", path: "/api/v1",                    desc: "API index + auth info" },
  { method: "GET", path: "/api/v1/accounts",            desc: "List all accounts with counts" },
  { method: "GET", path: "/api/v1/accounts/:id",        desc: "Account detail — contacts, cases, quotes, WOs" },
  { method: "GET", path: "/api/v1/cases",               desc: "List cases · filter: ?status= &account_id=" },
  { method: "GET", path: "/api/v1/quotations",          desc: "List quotations · filter: ?status= &account_id=" },
  { method: "GET", path: "/api/v1/products",            desc: "List products · filters: ?category=, ?status=" },
  { method: "GET", path: "/api/v1/products/:id",        desc: "Product detail" },
  { method: "GET", path: "/api/v1/projects",            desc: "Workforce projects + sub-projects · filters: ?status=, ?level=, ?parent_id=" },
  { method: "GET", path: "/api/v1/projects/:id",        desc: "Project detail — parent, level, sub-projects, links" },
  { method: "GET", path: "/api/v1/projects/:id/hours",  desc: "Hours for a project and its sub-projects, for a period (?from=&to=)" },
  { method: "GET", path: "/api/v1/projects/:id/invoices", desc: "Invoices raised from a project's hours" },
  { method: "POST", path: "/api/v1/projects/:id/invoices", desc: "Raise a draft invoice for a period ({from, to, granularity?, dry_run?})" },
  { method: "GET", path: "/api/v1/inventory",           desc: "List inventory · filter: ?low_stock=true" },
  { method: "GET", path: "/api/v1/inventory/:id",       desc: "Inventory item detail + transaction history" },
  { method: "GET", path: "/api/v1/invoices",            desc: "List invoices · filter: ?status= &account_id=" },
  { method: "GET", path: "/api/v1/invoices/:id",        desc: "Invoice detail — lines, payments, balance due" },
  { method: "GET", path: "/api/v1/purchase-orders",     desc: "List POs · filter: ?status= &supplier_id=" },
  { method: "GET", path: "/api/v1/purchase-orders/:id", desc: "Purchase order detail + receiving progress" },
  { method: "GET", path: "/api/v1/employees",           desc: "List staff · filter: ?status= &department= · key must name the employees scope" },
  { method: "GET", path: "/api/v1/employees/:id",       desc: "Employee detail" },
];

const API_COMING_SOON = [
  "POST /api/v1/cases",
  "PATCH /api/v1/cases/:id/status",
  "POST /api/v1/quotations",
  "GET  /api/v1/openapi.json",
  "POST /api/v1/webhooks",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 1800);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [saved, flash];
}

function Toggle({ on, onChange, accent }: { on: boolean; onChange: (v: boolean) => void; accent: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{ width: 40, height: 22, borderRadius: 11, background: on ? accent : "#d1d9e0", border: "none", cursor: "pointer", position: "relative", transition: "background 0.15s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left 0.15s", display: "block" }} />
    </button>
  );
}

/** General settings, same treatment as Workforce: eight sections is too many to
 *  hold open at once, so each collapses behind a one-line digest of what it
 *  currently holds. The prose `description` moves inside the body -- it is
 *  worth reading once, not on every visit. */
function Section({
  id, title, description, summary, children,
}: {
  id: string;
  title: string;
  description?: string;
  summary?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <SettingsSection id={`general-${id}`} title={title} summary={summary}>
        {description && (
          <p style={{ margin: "0 0 14px", fontSize: 12, color: c.muted, lineHeight: 1.5 }}>{description}</p>
        )}
        {children}
      </SettingsSection>
    </div>
  );
}

const THEME_LABEL: Record<string, string> = {
  classic: "Classic", modern: "Modern", nextgen: "Next-gen",
  nextgen2: "Nova", enterprise: "Enterprise",
};

/** Hex -> the preset's own name, so a collapsed Appearance header reads
 *  "accent Blue" rather than "accent #2e6be6". A custom hex has no name and
 *  falls back to the hex itself. */
const ACCENT_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(ACCENT_PRESETS).map((p) => [p.color.toLowerCase(), p.label])
);

function StatusBadge({ status }: { status: "active" | "ready" | "coming-soon" }) {
  const map = {
    "active":       { label: "Live",          bg: "var(--tealbg)", color: "var(--tealink)", border: "var(--teal)" },
    "ready":        { label: "Config ready",  bg: "var(--bluebg)", color: "var(--blueink)", border: "var(--blueline)" },
    "coming-soon":  { label: "Coming Soon",   bg: "var(--amberbg)", color: "var(--amberink)", border: "var(--amberline)" },
  }[status];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 6, background: map.bg, color: map.color, border: `1px solid ${map.border}`, whiteSpace: "nowrap" }}>
      {map.label}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GeneralSettingsPage() {
  const router = useRouter();
  const { settings, reset } = useSettings();
  const tenant = useTenant();
  const role = useUserRole();
  const tenantFeatures = tenant?.features as Record<string, boolean> | undefined;
  // tenant.accent_color is the single source of truth for brand colour (see Appearance below).
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const [saved, flashSaved] = useSavedFlash();

  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(tenant?.api_key ?? null);
  const [regenerating, startRegenerate] = useTransition();
  const [keyError, setKeyError] = useState("");

  // Push to external systems (on demand) -- see lib/webhookPush.ts
  const pushConfig = (tenant?.config as TenantConfig | undefined)?.integration_push;
  const [pushUrl, setPushUrl] = useState(pushConfig?.webhook_url ?? "");
  const [pushSecret, setPushSecret] = useState(pushConfig?.webhook_secret ?? "");
  const [pushSaving, startPushSave] = useTransition();
  const [pushSecretSaving, startPushSecretSave] = useTransition();
  const [pushSaved, flashPushSaved] = useSavedFlash();
  const [pushError, setPushError] = useState("");

  const savePushUrl = () => {
    setPushError("");
    startPushSave(async () => {
      const res = await fetch("/api/settings/integration-push", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhook_url: pushUrl.trim() }),
      });
      const json = await res.json();
      if (res.ok) flashPushSaved();
      else setPushError(json.error ?? "Failed to save");
    });
  };

  const { confirm } = useFeel();
  const regeneratePushSecret = async () => {
    if (pushSecret && !(await confirm({ title: "Generate a new signing secret?", body: "The old secret stops verifying the moment this is done — update it on the receiving end too.", confirmLabel: "Generate", tone: "danger" }))) return;
    setPushError("");
    startPushSecretSave(async () => {
      const res = await fetch("/api/settings/integration-push", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate_secret: true }),
      });
      const json = await res.json();
      if (res.ok) setPushSecret(json.webhook_secret ?? "");
      else setPushError(json.error ?? "Failed to generate secret");
    });
  };

  // Only show nav items whose feature is enabled at the tenant (platform admin) level.
  // If platform admin turns off a feature, local admin cannot see or re-enable it here.
  // Flattens children too (e.g. Quotations/Standard Quotes/Pipeline/Invoices under the
  // "Sales" parent) -- each gets its own row and its own toggle, keyed by its own href
  // in the same nav_hidden_hrefs array a parent-level toggle already uses. Previously
  // only top-level items were listed here, so there was no way to hide just one child
  // while keeping its siblings visible; hiding the parent hid all of them together.
  const allNavItems = NAV.flatMap((grp) =>
    grp.items
      .filter((item) => !item.featureKey || tenantFeatures?.[item.featureKey] === true)
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
  const [navSaving, startNavSave] = useTransition();
  const [navHidden, setNavHidden] = useState<string[]>(() => tenant?.config?.nav_hidden_hrefs ?? []);
  const isVisible = (href: string) => !navHidden.includes(href);

  const toggleNavItem = (href: string) => {
    const next = navHidden.includes(href) ? navHidden.filter((h) => h !== href) : [...navHidden, href];
    setNavHidden(next);
    startNavSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nav_hidden_hrefs: next }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // ── Quote type visibility ─────────────────────────────────────────────────
  const [qtSaving, startQtSave] = useTransition();
  const [qtVis, setQtVis] = useState<Partial<Record<QuoteTypeId, boolean>>>(() => tenant?.config?.quote_type_visibility ?? {});

  function isQtVisible(id: QuoteTypeId): boolean {
    return id in qtVis ? qtVis[id] !== false : true;
  }

  function toggleQtType(id: QuoteTypeId) {
    const next = { ...qtVis, [id]: !isQtVisible(id) };
    setQtVis(next);
    startQtSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_type_visibility: next }),
      });
      flashSaved();
      router.refresh();
    });
  }

  function TypeIcon({ id }: { id: string }) {
    const p = { size: 15, color: c.muted };
    switch (id) {
      case "quotation":    return <FileText {...p} />;
      case "technical":    return <Wrench {...p} />;
      case "budgetary":    return <BarChart2 {...p} />;
      case "supply":       return <Package {...p} />;
      case "amc":          return <CalendarCheck {...p} />;
      case "installation": return <Zap {...p} />;
      default:             return <FileText {...p} />;
    }
  }

  // ── Appearance — tenant-wide. Accent colour writes tenants.accent_color directly
  // (the same field the platform admin sets), so there's one source of truth, not
  // a local preset that gets silently overridden by it. ─────────────────────────
  const [apSaving, startApSave] = useTransition();
  const [compactSidebar, setCompactSidebar] = useState<boolean>(() => tenant?.config?.appearance?.compact_sidebar ?? false);
  const [accentColor, setAccentColor] = useState<string>(() => tenant?.accent_color || ACCENT_PRESETS.blue.color);
  // Provisioning sets the STARTING theme (TenantEditor.tsx); from here on it's
  // this workspace's own call, same as accent colour. useUiTheme() degrades a
  // retired "modern2"/"modern3" value to "modern" AND folds "nextgen2" into
  // "nextgen" (they share CSS) -- this picker needs the raw stored value so
  // a tenant on "nextgen2" sees that option selected, not plain "nextgen".
  const [theme, setTheme] = useState<"classic" | "modern" | "nextgen" | "nextgen2" | "enterprise">(() => {
    const raw = tenant?.config?.appearance?.ui_theme as string | undefined;
    if (raw === "nextgen" || raw === "nextgen2" || raw === "enterprise") return raw;
    if (raw === "modern" || raw === "modern2" || raw === "modern3") return "modern";
    return "classic";
  });
  const [themeSaving, startThemeSave] = useTransition();

  const saveTheme = (v: "classic" | "modern" | "nextgen" | "nextgen2" | "enterprise") => {
    setTheme(v);
    startThemeSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, ui_theme: v } }),
      });
      // A theme switch changes which major component tree Shell mounts
      // (Nova's sidebar/topbar/Account360Drawer/etc vs classic/modern's) --
      // router.refresh() only re-fetches server data and reconciles, it
      // does NOT force client components to remount, so any of THEIR
      // internal state (an open modal, a memoized layout choice) can
      // survive across the switch and end up paired with the new theme's
      // DOM (user-reported: switching nextgen -> Nova -> nextgen left the
      // page in a stuck, part-old-part-new visual state). A full reload
      // guarantees nothing stale survives a change this structural.
      flashSaved();
      window.location.reload();
    });
  };

  const saveAccentColor = (hex: string) => {
    setAccentColor(hex);
    startApSave(async () => {
      await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accent_color: hex }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // Nova's own accent hue -- independent of the classic accentColor above
  // (see the comment on TenantConfig.appearance.nova_accent_color). Empty
  // string = unset = Nova's default pink.
  const [novaAccentColor, setNovaAccentColor] = useState<string>(() => tenant?.config?.appearance?.nova_accent_color ?? "");
  const saveNovaAccentColor = (hex: string | null) => {
    setNovaAccentColor(hex ?? "");
    startApSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, nova_accent_color: hex || undefined } }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // Three pieces of chrome that used to require adopting a whole theme behind
  // a platform-admin flag. Each writes one boolean into config.appearance and
  // reloads, for the same reason saveTheme does: they change which components
  // Shell mounts, and router.refresh() doesn't remount client components.
  // On by default -- these ship WITH nextgen (see nextgenChromeOn); only an
  // explicit false, set right here, turns one off. Mirrors the hooks exactly,
  // or the switch would show off while the chrome is on.
  const [chrome, setChrome] = useState(() => ({
    top_bar_identity: tenant?.config?.appearance?.top_bar_identity !== false,
    command_palette: tenant?.config?.appearance?.command_palette !== false,
    navy_sidebar: tenant?.config?.appearance?.navy_sidebar !== false,
  }));
  const saveChrome = (key: keyof typeof chrome, v: boolean) => {
    const next = { ...chrome, [key]: v };
    setChrome(next);
    startApSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, ...next } }),
      });
      flashSaved();
      window.location.reload();
    });
  };

  const saveCompactSidebar = (v: boolean) => {
    setCompactSidebar(v);
    startApSave(async () => {
      // The route replaces config.appearance wholesale (it's a shallow merge
      // at the config-root level) -- spread the current object in, or this
      // silently drops whatever theme was just chosen above.
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, compact_sidebar: v } }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // ── Workspace name — writes tenants.name directly ──────────────────────────
  const [wsName, setWsName] = useState(tenant?.name ?? "");
  const [wsSaving, startWsSave] = useTransition();
  const wsNameDirty = wsName.trim() !== "" && wsName.trim() !== (tenant?.name ?? "");

  const saveWorkspaceName = () => {
    const name = wsName.trim();
    startWsSave(async () => {
      await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // ── Reset ────────────────────────────────────────────────────────────────────
  const [resetting, startReset] = useTransition();
  const resetTenantDefaults = async () => {
    if (!(await confirm({ title: "Reset navigation to defaults?", body: "Nav visibility and the compact sidebar go back to their defaults. Accent colour, workspace name and theme are untouched.", confirmLabel: "Reset" }))) return;
    setNavHidden([]);
    setCompactSidebar(false);
    startReset(async () => {
      // appearance is replaced wholesale by the route -- keep the theme
      // choice by carrying it forward explicitly, or this silently reverts
      // it to classic along with the things actually meant to be reset.
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nav_hidden_hrefs: [], appearance: { ui_theme: tenant?.config?.appearance?.ui_theme } }),
      });
      reset();
      flashSaved();
      router.refresh();
    });
  };

  const copyApiKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const regenerateApiKey = async () => {
    if (apiKey && !(await confirm({ title: "Generate a new API key?", body: "The current key stops working immediately. Anything using it — an ERP integration, an AI assistant's MCP config — needs the new one.", confirmLabel: "Generate", tone: "danger" }))) return;
    setKeyError("");
    startRegenerate(async () => {
      const res = await fetch("/api/settings/api-key", { method: "POST" });
      const json = await res.json();
      if (res.ok) setApiKey(json.api_key);
      else setKeyError(json.error ?? "Failed to generate key");
    });
  };

  return (
    <div style={{ maxWidth: 680 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 19, margin: 0, fontWeight: 600, paddingLeft: 12, borderLeft: `3px solid ${accent}` }}>
            General settings
          </h1>
          <p style={{ margin: "4px 0 0 12px", fontSize: 12, color: c.muted }}>Navigation, appearance, workspace, integrations, API</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 500, opacity: saved ? 1 : 0, transition: "opacity 0.3s" }}>✓ Saved</span>
          <button onClick={() => router.push(ROUTES.settings)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: accent, color: "#fff", border: "none", cursor: "pointer" }}>
            ← Settings
          </button>
        </div>
      </div>

      {/* ── 1. Navigation visibility ── */}
      <Section
        id="nav"
        title="Navigation visibility"
        summary={
          navHidden.length === 0
            ? `All ${allNavItems.length} items visible`
            : `${navHidden.length} hidden of ${allNavItems.length}`
        }
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
                  const visible = isVisible(item.href);
                  return (
                    <div key={item.href} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", paddingLeft: item.indent ? 28 : 4, borderTop: idx > 0 ? `1px solid ${c.line}` : "none", opacity: visible ? 1 : 0.4, transition: "opacity 0.15s" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: PILLAR_DOT[item.pillar] ?? "#378ADD" }} />
                      <span style={{ fontSize: 16, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>{item.label}</div>
                        {item.sub && <div style={{ fontSize: 11, color: c.hint }}>{item.sub}</div>}
                      </div>
                      <Toggle on={visible} onChange={() => toggleNavItem(item.href)} accent={accent} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <Pager page={navGroupPage} total={navGroups.length} pageSize={NAV_GROUPS_PER_PAGE} onPage={setNavGroupPage} />
      </Section>

      {/* ── 2. Quote types (only for tenants with the Quotations module) ── */}
      {tenantFeatures?.quotations === true && <Section
        id="quote-types"
        title="Quote types"
        summary={`${QUOTE_TYPES.filter((qt) => isQtVisible(qt.id as QuoteTypeId)).length} of ${QUOTE_TYPES.length} shown in the picker`}
        description="Show or hide offer types in the New Quotation picker. Hidden types (including Coming Soon ones you don't need) won't appear there at all."
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {QUOTE_TYPES.map((qt, idx) => {
            const visible = isQtVisible(qt.id as QuoteTypeId);
            return (
              <div key={qt.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderTop: idx > 0 ? `1px solid ${c.line}` : "none", opacity: visible ? 1 : 0.45, transition: "opacity 0.15s" }}>
                <TypeIcon id={qt.id} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>{qt.label}</div>
                  <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>{qt.description}</div>
                </div>
                {!qt.available && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: c.hint, background: c.panel2, border: `1px solid ${c.line}`, borderRadius: 4, padding: "2px 7px", letterSpacing: 0.3, textTransform: "uppercase" }}>
                    Coming soon
                  </span>
                )}
                <Toggle on={visible} onChange={() => !qtSaving && toggleQtType(qt.id as QuoteTypeId)} accent={accent} />
              </div>
            );
          })}
        </div>
      </Section>}

      {/* ── 3. Appearance ── */}
      <Section
        id="appearance"
        title="Appearance"
        summary={`${THEME_LABEL[theme]} · accent ${ACCENT_LABEL[accentColor.toLowerCase()] ?? accentColor}${compactSidebar ? " · compact sidebar" : ""}`}
        description="Applies to your whole workspace — every user, every device."
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Theme</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {([
              { value: "classic" as const, label: "Classic", desc: "Dark navy sidebar, the original look.", swatch: "linear-gradient(135deg, #152233, #0e1a28)" },
              { value: "modern" as const, label: "Modern", desc: "Denser cards, sharper borders, navy + gold.", swatch: "linear-gradient(135deg, #14294b, #0a1830)" },
              { value: "nextgen" as const, label: "Next-gen", desc: "Flat, minimal, real icons — with dark mode.", swatch: "linear-gradient(135deg, #ffffff, #eef3fe)" },
              // Next Experience program: offered only to tenants the PLATFORM
              // admin has flagged in (demo first, clients after validation) --
              // a workspace admin can't opt into the experiment on their own.
              ...(tenant?.features?.next_experience === true
                ? [{ value: "nextgen2" as const, label: "Nova", desc: "BPMSquare Nova — the Business OS. Command palette, engagement layer, identity in the top bar.", swatch: "linear-gradient(135deg, #eef3fe, #dbe7fd)" }]
                : []),
              // Same platform-admin-only gate (owner correction 2026-08-25:
              // this shipped without one and surfaced directly in the demo
              // tenant's own picker, which isn't this codebase's pattern).
              ...(tenant?.features?.enterprise_theme === true
                ? [{ value: "enterprise" as const, label: "Enterprise", desc: "Dark navy sidebar, clean white workspace.", swatch: "linear-gradient(135deg, #152233 0%, #152233 42%, #ffffff 42%, #ffffff 100%)" }]
                : []),
            ]).map((opt) => {
              const selected = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => !themeSaving && saveTheme(opt.value)}
                  style={{
                    display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10,
                    border: selected ? `2px solid ${accent}` : `1px solid ${c.line}`,
                    background: c.panel, cursor: themeSaving ? "wait" : "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ height: 34, borderRadius: 6, background: opt.swatch, border: `1px solid ${c.line}` }} />
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: selected ? accent : c.ink }}>{opt.label}</span>
                    {selected && <span style={{ fontSize: 11, color: accent }}>✓</span>}
                  </span>
                  <span style={{ fontSize: 11, color: c.hint, lineHeight: 1.4 }}>{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: 20, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Accent colour</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(Object.entries(ACCENT_PRESETS) as [AccentPreset, typeof ACCENT_PRESETS[AccentPreset]][]).map(([key, preset]) => {
              const selected = accentColor.toLowerCase() === preset.color.toLowerCase();
              return (
                <button key={key} onClick={() => !apSaving && saveAccentColor(preset.color)} title={preset.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: selected ? `2px solid ${preset.color}` : `2px solid ${c.line}`, background: selected ? preset.colorBg : "var(--panel)", transition: "all 0.15s" }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: preset.color, flexShrink: 0, boxShadow: selected ? `0 0 0 2px ${preset.color}44` : "none" }} />
                  <span style={{ fontSize: 12.5, fontWeight: selected ? 600 : 400, color: selected ? preset.color : c.muted }}>{preset.label}</span>
                  {selected && <span style={{ fontSize: 12, color: preset.color }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
        {tenant?.features?.next_experience === true && (
          <div style={{ marginBottom: 20, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: c.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Nova accent colour</div>
            <div style={{ fontSize: 11, color: c.hint, marginBottom: 10 }}>The signature hue Nova uses for its command bar, tab underline and highlights — independent of the accent colour above.</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {NOVA_ACCENT_PRESETS.map((preset) => {
                const selected = novaAccentColor === "" ? preset.color === null : novaAccentColor.toLowerCase() === preset.color?.toLowerCase();
                return (
                  <button key={preset.label} onClick={() => !apSaving && saveNovaAccentColor(preset.color)} title={preset.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: selected ? `2px solid ${preset.color ?? "#E84393"}` : `2px solid ${c.line}`, background: selected ? "var(--panel2)" : "var(--panel)", transition: "all 0.15s" }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", background: preset.color ?? "linear-gradient(135deg, #FF6B35, #E84393)", flexShrink: 0, boxShadow: selected ? `0 0 0 2px ${(preset.color ?? "#E84393")}44` : "none" }} />
                    <span style={{ fontSize: 12.5, fontWeight: selected ? 600 : 400, color: selected ? (preset.color ?? "#E84393") : c.muted }}>{preset.label}</span>
                    {selected && <span style={{ fontSize: 12, color: preset.color ?? "#E84393" }}>✓</span>}
                  </button>
                );
              })}
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, border: `2px solid ${c.line}`, cursor: "pointer" }}>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(novaAccentColor) ? novaAccentColor : "#E84393"}
                  onChange={(e) => !apSaving && saveNovaAccentColor(e.target.value)}
                  style={{ width: 22, height: 22, border: "none", padding: 0, background: "none", cursor: "pointer" }}
                />
                <span style={{ fontSize: 12.5, color: c.muted }}>Custom</span>
              </label>
            </div>
          </div>
        )}
        {/* Plain nextgen only -- Nova has its own answers for all three, and
            classic/modern build their chrome differently. */}
        {theme === "nextgen" && (
          <div style={{ marginBottom: 4, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: c.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Layout</div>
            <div style={{ fontSize: 11, color: c.hint, marginBottom: 4 }}>
              These come with Next-gen and are on already — turn one off if you don&apos;t want it.
              Changing one reloads the page.
            </div>
            {([
              { key: "top_bar_identity" as const, label: "Sign-in name in the top right", hint: "Moves your name and sign-out out of the sidebar footer into the top bar, and frees up the bottom of the rail." },
              { key: "command_palette" as const, label: "Command palette on Ctrl + K", hint: "One key opens a search-and-jump box over the page — records, screens, and \"new …\" actions. Search in the top bar keeps working; it just stops answering Ctrl + K." },
              { key: "navy_sidebar" as const, label: "Navy sidebar in light mode", hint: "Dark navy left rail against the light workspace, with bright nav text and a clearly marked selected item. Dark mode is unaffected." },
            ]).map(({ key, label, hint }, i) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderTop: i > 0 ? `1px solid ${c.line}` : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>{label}</div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2, lineHeight: 1.5 }}>{hint}</div>
                </div>
                <Toggle on={chrome[key]} onChange={(v) => !apSaving && saveChrome(key, v)} accent={accent} />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>Compact sidebar</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>Reduce padding between navigation items</div>
          </div>
          <Toggle on={compactSidebar} onChange={(v) => !apSaving && saveCompactSidebar(v)} accent={accent} />
        </div>
      </Section>

      {/* ── 4. Workspace ── */}
      <Section
        id="workspace"
        title="Workspace"
        summary={tenant?.name || "Unnamed workspace"}
        description="Your organisation's name, shown in the sidebar header."
      >
        <div style={{ display: "flex", gap: 10 }}>
          <input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Workspace name" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${wsNameDirty ? accent : c.line}`, fontSize: 13, color: c.ink, outline: "none", transition: "border-color 0.15s" }} />
          <button onClick={saveWorkspaceName} disabled={!wsNameDirty || wsSaving} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: wsNameDirty ? "pointer" : "default", background: wsNameDirty ? accent : c.line, color: wsNameDirty ? "#fff" : c.hint, transition: "all 0.15s" }}>
            {wsSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </Section>

      {/* ── Email output — where outbound mail really goes (admin only) ── */}
      {role === "admin" && <EmailOutputSection accent={accent} />}

      {/* ── 4. Integrations ── */}
      <Section
        id="integrations"
        title="Integrations"
        summary={`${INTEGRATIONS.filter((i) => i.status === "active").length} live · ${INTEGRATIONS.length} available`}
        description="Connect external services. Items marked Coming Soon are on the roadmap."
      >
        {INTEGRATIONS.map((intg, idx) => (
          <div key={intg.name} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 4px", borderTop: idx > 0 ? `1px solid ${c.line}` : "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: c.panel2, border: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
              {intg.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{intg.name}</span>
                <StatusBadge status={intg.status} />
              </div>
              <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.5 }}>{intg.desc}</div>
              <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>{intg.note}</div>
            </div>
          </div>
        ))}
      </Section>

      {/* ── 5. Developer — REST API v1 ── */}
      <Section
        id="developer"
        title="Developer — REST API v1"
        summary={
          role !== "admin"
            ? `${API_ENDPOINTS.length} endpoints live`
            : `${apiKey ? "API key generated" : "No API key yet"} · ${API_ENDPOINTS.length} endpoints live`
        }
        description="Live REST API with an enriched query layer (filter / select / sort / aggregate / search), an OpenAPI spec and a change feed. Authenticate with: Authorization: Bearer <API key>"
      >

        {/* API key row — admin only: this key grants read access to every
            account/case/quote/invoice/etc. in this tenant via the v1 API. */}
        {role === "admin" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>API Key</div>
              {apiKey ? (
                <code style={{ fontSize: 12.5, color: c.ink, fontFamily: "monospace", wordBreak: "break-all" }}>{apiKey}</code>
              ) : (
                <div style={{ fontSize: 12.5, color: c.hint, fontStyle: "italic" }}>No key generated yet</div>
              )}
              {keyError && <div style={{ fontSize: 11, color: "var(--err-ink)", marginTop: 3 }}>{keyError}</div>}
            </div>
            {apiKey && (
              <button onClick={copyApiKey} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: "pointer", flexShrink: 0, color: copied ? "var(--teal)" : c.muted }}>
                {copied ? "✓ Copied" : "Copy key"}
              </button>
            )}
            <button onClick={regenerateApiKey} disabled={regenerating} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: regenerating ? "not-allowed" : "pointer", flexShrink: 0, color: c.muted }}>
              {regenerating ? "…" : apiKey ? "Regenerate" : "Generate key"}
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: c.hint, marginBottom: 14 }}>Ask a workspace admin to generate or view the API key.</div>
        )}

        {role === "admin" && <ApiKeysPanel />}
        {role === "admin" && <WebhooksPanel />}

        {/* Endpoints */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Available now</div>
          {API_ENDPOINTS.map((ep) => (
            <div key={ep.path} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${c.line}` }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--blueink)", background: "var(--bluebg)", borderRadius: 5, padding: "2px 7px", flexShrink: 0, fontFamily: "monospace" }}>{ep.method}</span>
              <code style={{ fontSize: 12, color: c.ink, flex: 1, fontFamily: "monospace" }}>{ep.path}</code>
              <span style={{ fontSize: 11, color: c.muted, textAlign: "right" }}>{ep.desc}</span>
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Coming soon</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {API_COMING_SOON.map((ep) => (
              <code key={ep} style={{ fontSize: 11, color: c.hint, background: c.panel2, borderRadius: 5, padding: "3px 8px", border: `1px solid ${c.line}`, fontFamily: "monospace" }}>
                {ep}
              </code>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 5b. Push to external systems (on demand) ── */}
      <Section
        id="push"
        title="Push to external systems"
        summary={
          role !== "admin"
            ? "Admin only"
            : pushUrl.trim()
              ? `${pushUrl.trim().replace(/^https?:\/\//, "").split("/")[0]}${pushSecret ? " · signed" : " · unsigned"}`
              : "Not configured"
        }
        description="Send a single record to your ERP or another system right now, on demand -- a rep clicking &quot;Push to ERP&quot; on a record. Different from the Webhooks integration above (automatic, event-driven, still Coming Soon)."
      >
        {role === "admin" ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Receiving URL</label>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  value={pushUrl}
                  onChange={(e) => setPushUrl(e.target.value)}
                  placeholder="https://your-erp.example.com/webhooks/bpmsquare"
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, outline: "none" }}
                />
                <button onClick={savePushUrl} disabled={pushSaving} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: pushSaving ? "not-allowed" : "pointer", background: pushSaved ? "var(--teal)" : accent, color: "#fff" }}>
                  {pushSaving ? "Saving…" : pushSaved ? "✓ Saved" : "Save"}
                </button>
              </div>
              {pushError && <div style={{ fontSize: 11.5, color: "var(--err-ink)", marginTop: 6 }}>{pushError}</div>}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>Signing secret</div>
                {pushSecret ? (
                  <code style={{ fontSize: 12.5, color: c.ink, fontFamily: "monospace", wordBreak: "break-all" }}>{pushSecret}</code>
                ) : (
                  <div style={{ fontSize: 12.5, color: c.hint, fontStyle: "italic" }}>Not generated -- pushes will be unsigned</div>
                )}
                <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>Sent as the X-BPMSquare-Signature header (HMAC-SHA256 of the request body) so your endpoint can verify it's really from BPMSquare.</div>
              </div>
              <button onClick={regeneratePushSecret} disabled={pushSecretSaving} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: pushSecretSaving ? "not-allowed" : "pointer", flexShrink: 0, color: c.muted }}>
                {pushSecretSaving ? "…" : pushSecret ? "Regenerate" : "Generate"}
              </button>
            </div>

            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 10 }}>Live today on Accounts (the "Push to ERP" action on an account's page) -- extends to other objects the same way.</div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: c.hint }}>Ask a workspace admin to configure this.</div>
        )}
      </Section>

      {/* ── 6. Reset ── */}
      <Section id="reset" title="Reset" summary="Restore navigation & layout defaults">
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: c.muted, lineHeight: 1.5 }}>
          Restore navigation visibility and compact sidebar to defaults, for the whole workspace. Accent colour and
          workspace name aren't reset since there's no default to go back to. Your data is not affected.
        </p>
        <button onClick={resetTenantDefaults} disabled={resetting} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "var(--redbg)", color: "var(--redink)", border: "1px solid var(--err-line)", cursor: "pointer" }}>
          {resetting ? "Resetting…" : "Reset navigation & layout to defaults"}
        </button>
      </Section>

      <div style={{ padding: "12px 4px", fontSize: 11.5, color: c.hint, lineHeight: 1.8 }}>
        BPMSquare{tenant?.name ? ` · ${tenant.name}` : ""}
      </div>
    </div>
  );
}
