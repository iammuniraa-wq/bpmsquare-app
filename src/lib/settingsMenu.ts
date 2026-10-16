import { ROUTES, type TenantFeatures } from "@/lib/constants";
import type { WorkcenterKey } from "@/lib/workcenters";

// The Settings menu: one table that says where every settings page lives, who
// may reach it and which module it belongs to. The gating fields are the old
// hub tiles' rules, unchanged -- the menu only regroups the same pages.

export type SettingsGroupId =
  | "company" | "access" | "sales" | "service" | "workforce" | "data" | "integrations" | "appearance";

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "access", label: "Users & access" },
  { id: "sales", label: "Sales" },
  { id: "service", label: "Service" },
  { id: "workforce", label: "Workforce" },
  { id: "data", label: "Data" },
  { id: "integrations", label: "Integrations" },
  { id: "appearance", label: "Appearance" },
];

export type SettingsMenuEntry = {
  id: string;
  label: string;
  description: string;
  href: string;
  group: SettingsGroupId;
  /** Extra search terms beyond the label, description and group name. */
  keywords?: string[];
  /** Lives outside /settings (Business roles, Dynamic Pricing): never "active" here. */
  external?: boolean;
  adminOnly: boolean;
  /** Hidden entirely when this tenant feature is off (module not enabled). */
  featureKey?: keyof TenantFeatures;
  /** Shown when ANY of these features is on -- for pages serving several modules. */
  featureAnyOf?: (keyof TenantFeatures)[];
  /** For an adminOnly entry: also reachable by a non-admin whose Business
   * Role(s) grant EDIT on this workcenter. Omitted for surfaces that stay
   * strictly admin-only. */
  relatedWorkcenter?: WorkcenterKey;
};

const CRM_OBJECT_FEATURES: (keyof TenantFeatures)[] = ["accounts", "contacts", "quotations", "cases", "work_orders", "assets", "suppliers", "purchasing", "invoices"];

export const SETTINGS_MENU: SettingsMenuEntry[] = [
  // ── Company ──
  { id: "general", group: "company", label: "General settings", description: "Workspace name, navigation, appearance, integrations, developer API", href: ROUTES.settingsGeneral, keywords: ["workspace", "navigation", "theme", "api", "currency"], adminOnly: false },
  { id: "entities", group: "company", label: "Entities & Tax", description: "Legal entities, print branding, and tax settings for quotations and PDFs", href: ROUTES.settingsEntities, keywords: ["gst", "vat", "legal", "branding", "logo"], adminOnly: true, featureKey: "quotations", relatedWorkcenter: "quotations" },
  { id: "number-ranges", group: "company", label: "Number ranges", description: "One place for every business-ID convention — Quote ID format and all system-generated ranges", href: ROUTES.settingsNumberRanges, keywords: ["ids", "prefix", "numbering", "sequence"], adminOnly: true },

  // ── Users & access ──
  { id: "team", group: "access", label: "Team", description: "Invite teammates and manage roles", href: ROUTES.settingsTeam, keywords: ["users", "invite", "members", "roles"], adminOnly: true },
  { id: "business-roles", group: "access", label: "Business roles", description: "Named roles that decide which modules and screens each person reaches", href: ROUTES.administrationBusinessRoles, keywords: ["permissions", "workcenter", "access"], external: true, adminOnly: true, featureKey: "business_roles" },

  // ── Sales ──
  { id: "statuses", group: "sales", label: "Statuses & assets", description: "Configure pipeline stages and equipment print fields", href: ROUTES.settingsStatuses, keywords: ["pipeline", "stages", "quote status"], adminOnly: true, featureKey: "assets", relatedWorkcenter: "quotations" },
  // featureAnyOf, not featureKey: "products" -- the tree feeds the products
  // screens AND any field whose selectSource is product_category, which can
  // sit on an object a tenant without the Products module still uses.
  { id: "product-categories", group: "sales", label: "Product categories", description: "The category tree products are filed under, and that category fields pick from", href: ROUTES.settingsSales, keywords: ["products", "tree"], adminOnly: true, featureAnyOf: ["products", "quotations"], relatedWorkcenter: "quotations" },
  { id: "text-templates", group: "sales", label: "Text templates", description: "Saved snippets for line items, notes and terms", href: ROUTES.configTemplates, keywords: ["snippets", "terms", "notes"], adminOnly: false, featureKey: "quotations" },
  { id: "email-templates", group: "sales", label: "Email templates", description: "Subject and body pairs your team can pick between when emailing a quote", href: ROUTES.settingsEmailTemplates, keywords: ["mail", "subject"], adminOnly: true, featureKey: "quotations", relatedWorkcenter: "quotations" },
  { id: "pricing", group: "sales", label: "Small Scale Pricing", description: "Static standard rates for labour, materials, testing and transport — the simple pricing model for small tenants", href: ROUTES.configPricing, keywords: ["rates", "labour", "materials"], adminOnly: false, featureKey: "quotations" },
  { id: "dynamic-pricing", group: "sales", label: "Dynamic Pricing", description: "Pick how you price, set your numbers, go live — has its own workcenter with rates, setup wizard, history and an advanced config cockpit", href: ROUTES.pricingSetup, keywords: ["pricing engine", "margin", "cost"], external: true, adminOnly: true, featureKey: "pricing_engine", relatedWorkcenter: "pricing" },
  { id: "coverage", group: "sales", label: "Coverage", description: "Teams, rule-based segments and the wiring that replaces flat territory/sales org assignment — also drives auto-ownership, product availability and ERP routing", href: ROUTES.settingsCoverage, keywords: ["territory", "sales org", "segments", "ownership"], adminOnly: true, featureKey: "coverage_model" },
  { id: "rfq", group: "sales", label: "RFQ", description: "How requests for quotation reach suppliers and how their replies come back — your own mailbox or BPMSquare's, reply window, reminders and terms", href: ROUTES.settingsRfq, keywords: ["supplier", "request for quotation", "reply"], adminOnly: true, featureKey: "rfq", relatedWorkcenter: "rfqs" },

  // ── Service ──
  { id: "account-360", group: "service", label: "Account 360", description: "The account drawer: which cards it shows, and the external sources plugged into it", href: ROUTES.settingsAccount360, keywords: ["account drawer", "health", "cards"], adminOnly: true, featureAnyOf: ["next_experience", "spectacular_theme"] },

  // ── Workforce ──
  { id: "workforce", group: "workforce", label: "Workforce", description: "Attendance rules, timezone, break deduction, leave and retention — plus punch sites and shifts", href: ROUTES.settingsWorkforce, keywords: ["attendance", "shifts", "sites", "leave", "kiosk", "punch"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },

  // ── Data ──
  { id: "custom-fields", group: "data", label: "Custom fields", description: "Add fields to any object — included automatically in the API and MCP", href: ROUTES.configCustomFields, keywords: ["fields", "columns", "extra"], adminOnly: true, featureAnyOf: [...CRM_OBJECT_FEATURES, "business_roles"] },
  { id: "deletion-log", group: "data", label: "Deleted records", description: "Audit log of permanently deleted objects", href: ROUTES.settingsDeletionLog, keywords: ["audit", "trash", "removed"], adminOnly: true, featureAnyOf: CRM_OBJECT_FEATURES },

  // ── Integrations ──
  { id: "connectors", group: "integrations", label: "Connectors", description: "Connect BPMSquare to other systems — Slack today, more on the way", href: ROUTES.settingsConnectors, keywords: ["slack", "dynamics", "d365"], adminOnly: true },
];

/** Entries the signed-in person may open, grouped, empty groups dropped. */
export function visibleSettingsMenu(ctx: {
  isAdmin: boolean;
  canEdit: (workcenter: WorkcenterKey) => boolean;
  features: Partial<TenantFeatures> | undefined;
}): { id: SettingsGroupId; label: string; items: SettingsMenuEntry[] }[] {
  const canReach = (item: SettingsMenuEntry) =>
    (!item.adminOnly || ctx.isAdmin || (item.relatedWorkcenter ? ctx.canEdit(item.relatedWorkcenter) : false)) &&
    (!item.featureKey || ctx.features?.[item.featureKey] === true) &&
    (!item.featureAnyOf || item.featureAnyOf.some((k) => ctx.features?.[k] === true));

  return SETTINGS_GROUPS
    .map((g) => ({ ...g, items: SETTINGS_MENU.filter((m) => m.group === g.id && canReach(m)) }))
    .filter((g) => g.items.length > 0);
}

/** The browser-safe shape the shell draws: no gating fields cross to the client. */
export type SettingsMenuGroup = {
  id: SettingsGroupId;
  label: string;
  items: Pick<SettingsMenuEntry, "id" | "label" | "description" | "href" | "keywords" | "external">[];
};

export function toMenuGroups(groups: ReturnType<typeof visibleSettingsMenu>): SettingsMenuGroup[] {
  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    items: g.items.map(({ id, label, description, href, keywords, external }) => ({ id, label, description, href, keywords, external })),
  }));
}

/** Items whose name, description, keywords or group contain every word typed. */
export function filterSettingsMenu(groups: SettingsMenuGroup[], query: string): SettingsMenuGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const hay = `${item.label} ${item.description} ${(item.keywords ?? []).join(" ")} ${g.label}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }),
    }))
    .filter((g) => g.items.length > 0);
}

/** The menu item a pathname belongs to: the longest href that is the path or a parent of it. */
export function activeSettingsItemId(groups: SettingsMenuGroup[], pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const g of groups) {
    for (const item of g.items) {
      if (item.external) continue;
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (!best || item.href.length > best.len) best = { id: item.id, len: item.href.length };
      }
    }
  }
  return best?.id ?? null;
}
