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
  { id: "company", group: "company", label: "Company profile", description: "Your organisation's name, shown in the sidebar header", href: ROUTES.settingsCompany, keywords: ["general", "general settings", "workspace", "name", "organisation"], adminOnly: false },
  { id: "entities", group: "company", label: "Entities & Tax", description: "Legal entities, print branding, and tax settings for quotations and PDFs", href: ROUTES.settingsEntities, keywords: ["gst", "vat", "legal", "branding", "logo"], adminOnly: true, featureKey: "quotations", relatedWorkcenter: "quotations" },
  { id: "currency", group: "company", label: "Currency", description: "How every amount in this workspace is shown, printed and emailed", href: ROUTES.settingsCurrency, keywords: ["money", "rupee", "dollar", "format"], adminOnly: true },
  { id: "number-ranges", group: "company", label: "Number ranges", description: "One place for every business-ID convention — Quote ID format and all system-generated ranges", href: ROUTES.settingsNumberRanges, keywords: ["ids", "prefix", "numbering", "sequence"], adminOnly: true },

  // ── Users & access ──
  { id: "team", group: "access", label: "Team", description: "Invite teammates and manage roles", href: ROUTES.settingsTeam, keywords: ["users", "invite", "members", "roles"], adminOnly: true },
  { id: "business-roles", group: "access", label: "Business roles", description: "Named roles that decide which modules and screens each person reaches", href: ROUTES.administrationBusinessRoles, keywords: ["permissions", "workcenter", "access"], external: true, adminOnly: true, featureKey: "business_roles" },
  { id: "navigation", group: "access", label: "Navigation visibility", description: "Show or hide sidebar items for the whole workspace", href: ROUTES.settingsNavigation, keywords: ["general", "sidebar", "menu", "hide"], adminOnly: false },
  { id: "coverage", group: "access", label: "Coverage", description: "Teams, rule-based segments and the wiring that replaces flat territory/sales org assignment — also drives auto-ownership, product availability and ERP routing", href: ROUTES.settingsCoverage, keywords: ["territory", "sales org", "segments", "ownership"], adminOnly: true, featureKey: "coverage_model" },

  // ── Sales ──
  { id: "statuses", group: "sales", label: "Pipeline & quote statuses", description: "The stages a quotation moves through, and which ones close it", href: ROUTES.settingsStatuses, keywords: ["pipeline", "stages", "quote status", "statuses & assets"], adminOnly: true, featureKey: "quotations", relatedWorkcenter: "quotations" },
  { id: "quote-types", group: "sales", label: "Quote types", description: "Show or hide offer types in the New Quotation picker", href: ROUTES.settingsQuoteTypes, keywords: ["offer", "technical", "budgetary", "amc", "installation"], adminOnly: false, featureKey: "quotations" },
  { id: "text-templates", group: "sales", label: "Text templates", description: "Saved snippets for line items, notes and terms", href: ROUTES.configTemplates, keywords: ["snippets", "terms", "notes"], adminOnly: false, featureKey: "quotations" },
  { id: "email-templates", group: "sales", label: "Email templates", description: "Subject and body pairs your team can pick between when emailing a quote", href: ROUTES.settingsEmailTemplates, keywords: ["mail", "subject"], adminOnly: true, featureKey: "quotations", relatedWorkcenter: "quotations" },
  { id: "pricing", group: "sales", label: "Small Scale Pricing", description: "Static standard rates for labour, materials, testing and transport — the simple pricing model for small tenants", href: ROUTES.configPricing, keywords: ["rates", "labour", "materials"], adminOnly: false, featureKey: "quotations" },
  { id: "dynamic-pricing", group: "sales", label: "Dynamic Pricing", description: "Pick how you price, set your numbers, go live — has its own workcenter with rates, setup wizard, history and an advanced config cockpit", href: ROUTES.pricingSetup, keywords: ["pricing engine", "margin", "cost"], external: true, adminOnly: true, featureKey: "pricing_engine", relatedWorkcenter: "pricing" },
  { id: "rfq", group: "sales", label: "RFQ", description: "How requests for quotation reach suppliers and how their replies come back — your own mailbox or BPMSquare's, reply window, reminders and terms", href: ROUTES.settingsRfq, keywords: ["supplier", "request for quotation", "reply"], adminOnly: true, featureKey: "rfq", relatedWorkcenter: "rfqs" },
  { id: "estimate-templates", group: "sales", label: "Estimate templates", description: "The inputs, rates and rule lines that turn a few answers into a bill of materials, a cost build-up and a quote", href: ROUTES.settingsEstimateTemplates, keywords: ["estimator", "estimate", "bom", "rules", "formula", "precast"], adminOnly: true, featureKey: "estimator", relatedWorkcenter: "estimates" },
  { id: "account-360", group: "sales", label: "Account 360", description: "The account drawer: which cards it shows, and the external sources plugged into it", href: ROUTES.settingsAccount360, keywords: ["service", "account drawer", "health", "cards"], adminOnly: true, featureAnyOf: ["next_experience", "spectacular_theme"] },

  // ── Service ──
  { id: "asset-print-fields", group: "service", label: "Asset print fields", description: "Which equipment fields appear in the Equipment Details section of a printed quote", href: ROUTES.settingsAssetPrintFields, keywords: ["equipment", "nameplate", "statuses & assets"], adminOnly: true, featureKey: "assets", relatedWorkcenter: "quotations" },

  // ── Workforce ──
  { id: "wf-attendance", group: "workforce", label: "Attendance rules", description: "Timezone, break deduction, late marks, weekly off days and alternate Saturdays", href: ROUTES.settingsWorkforceAttendance, keywords: ["workforce", "timezone", "week off", "saturday", "leave carry forward", "login"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },
  { id: "wf-shifts", group: "workforce", label: "Shifts", description: "Working hours people are expected to keep, grace and night shifts", href: ROUTES.settingsWorkforceShifts, keywords: ["workforce", "grace", "night"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },
  { id: "wf-sites", group: "workforce", label: "Sites", description: "Punch locations, geofence radius and the supervisors who approve requests", href: ROUTES.settingsWorkforceSites, keywords: ["workforce", "geofence", "location", "supervisor"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },
  { id: "wf-leave-types", group: "workforce", label: "Leave types", description: "What people can request time off as, and their quotas", href: ROUTES.settingsWorkforceLeaveTypes, keywords: ["workforce", "leave", "quota", "holiday"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },
  { id: "wf-verification", group: "workforce", label: "Punching & verification", description: "Punch types, face and selfie checks, and location rules", href: ROUTES.settingsWorkforceVerification, keywords: ["workforce", "overtime", "work from home", "selfie", "face", "geofence", "passkey"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },
  { id: "wf-kiosks", group: "workforce", label: "Kiosks", description: "Register door tablets for face punching", href: ROUTES.settingsWorkforceKiosks, keywords: ["workforce", "tablet", "device", "face"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },
  { id: "wf-reminders", group: "workforce", label: "Reminders & notifications", description: "Phone reminders and workforce emails", href: ROUTES.settingsWorkforceReminders, keywords: ["workforce", "alerts", "push", "email"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },
  { id: "wf-employment", group: "workforce", label: "Employment & billing", description: "Employment types, and bill and cost rates for project hours", href: ROUTES.settingsWorkforceEmployment, keywords: ["workforce", "contract", "rates", "projects", "invoice"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },

  // ── Data ──
  { id: "custom-fields", group: "data", label: "Custom fields", description: "Add fields to any object — included automatically in the API and MCP", href: ROUTES.configCustomFields, keywords: ["fields", "columns", "extra"], adminOnly: true, featureAnyOf: [...CRM_OBJECT_FEATURES, "business_roles"] },
  // featureAnyOf, not featureKey: "products" -- the tree feeds the products
  // screens AND any field whose selectSource is product_category, which can
  // sit on an object a tenant without the Products module still uses.
  { id: "product-categories", group: "data", label: "Product categories", description: "The category tree products are filed under, and that category fields pick from", href: ROUTES.settingsSales, keywords: ["products", "tree"], adminOnly: true, featureAnyOf: ["products", "quotations"], relatedWorkcenter: "quotations" },
  { id: "deletion-log", group: "data", label: "Deleted records", description: "Audit log of permanently deleted objects", href: ROUTES.settingsDeletionLog, keywords: ["audit", "trash", "removed"], adminOnly: true, featureAnyOf: CRM_OBJECT_FEATURES },

  // ── Integrations ──
  { id: "connectors", group: "integrations", label: "Connectors", description: "Connect BPMSquare to other systems — Slack today, more on the way", href: ROUTES.settingsConnectors, keywords: ["slack", "dynamics", "d365"], adminOnly: true },
  { id: "developer", group: "integrations", label: "API keys & developer", description: "Your API key, scoped keys, the REST API endpoints and the integrations catalogue", href: ROUTES.settingsDeveloper, keywords: ["general", "api", "rest", "token", "mcp", "openapi", "bearer"], adminOnly: false },
  { id: "push", group: "integrations", label: "Webhooks & push", description: "Event webhooks, and pushing a single record to your ERP on demand", href: ROUTES.settingsPush, keywords: ["erp", "signing secret", "events", "outbound"], adminOnly: true },
  { id: "email-output", group: "integrations", label: "Email output", description: "Where quotations, invoices, campaigns and workforce notifications are actually delivered", href: ROUTES.settingsEmailOutput, keywords: ["mail", "redirect", "demo", "inbox", "resend"], adminOnly: true },

  // ── Appearance ──
  { id: "appearance", group: "appearance", label: "Theme & colours", description: "Theme, accent colour and the compact sidebar for the whole workspace", href: ROUTES.settingsAppearance, keywords: ["general", "appearance", "look", "dark", "nova", "classic", "accent", "brand colour"], adminOnly: false },
  { id: "dashboard", group: "appearance", label: "Dashboard content", description: "Business news and tips for a dashboard that has no data of its own yet", href: ROUTES.settingsDashboard, keywords: ["news", "tips", "home"], adminOnly: true },
  { id: "reset", group: "appearance", label: "Reset layout", description: "Restore navigation visibility and the compact sidebar to their defaults", href: ROUTES.settingsReset, keywords: ["default", "restore"], adminOnly: false },
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
