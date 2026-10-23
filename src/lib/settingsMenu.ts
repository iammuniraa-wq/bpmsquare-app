import { ROUTES, type TenantFeatures } from "@/lib/constants";
import type { WorkcenterKey } from "@/lib/workcenters";

// The Settings menu: one table that says where every settings page lives, who
// may reach it and which module it belongs to. The gating fields are the old
// hub tiles' rules, unchanged -- the menu only regroups the same pages.

export type SettingsGroupId =
  | "company" | "access" | "sales" | "marketing" | "service" | "workforce" | "data" | "integrations" | "appearance";

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "access", label: "Users & access" },
  { id: "sales", label: "Sales" },
  { id: "marketing", label: "Marketing" },
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
  /** Hidden when this tenant feature is ON: the page it points to is replaced by another (Webhooks & push -> Webhooks). */
  hiddenWhenFeature?: keyof TenantFeatures;
  /** For an adminOnly entry: also reachable by a non-admin whose Business
   * Role(s) grant EDIT on this workcenter. Omitted for surfaces that stay
   * strictly admin-only. */
  relatedWorkcenter?: WorkcenterKey;
};


const CRM_OBJECT_FEATURES: (keyof TenantFeatures)[] = ["accounts", "contacts", "quotations", "cases", "work_orders", "assets", "suppliers", "purchasing", "invoices"];

export const SETTINGS_MENU: SettingsMenuEntry[] = [
  // ── Company ──
  { id: "company", group: "company", label: "Company", description: "Name, logo and letterhead, legal entities, tax and currency, and how IDs are numbered", href: ROUTES.settingsCompany, keywords: ["general", "general settings", "workspace", "name", "organisation", "company profile", "entities", "entities & tax", "gst", "vat", "legal", "branding", "logo", "letterhead", "currency", "money", "rupee", "dollar", "format", "number ranges", "ids", "prefix", "numbering", "sequence"], adminOnly: true },

  // ── Users & access ──
  { id: "people", group: "access", label: "People", description: "Invite people, set who is admin, and choose which screens each person reaches", href: ROUTES.settingsPeople, keywords: ["team", "users", "invite", "members", "roles", "business users", "business roles", "permissions", "workcenter", "access", "login", "lock"], adminOnly: true },
  { id: "coverage", group: "access", label: "Coverage", description: "Teams, rule-based segments and the wiring that replaces flat territory/sales org assignment — also drives auto-ownership, product availability and ERP routing", href: ROUTES.settingsCoverage, keywords: ["territory", "sales org", "segments", "ownership"], adminOnly: true, featureKey: "coverage_model" },

  // ── Sales ──
  { id: "quotations", group: "sales", label: "Quotations", description: "Quote statuses, offer types, saved texts and emails, and which equipment fields print", href: ROUTES.settingsQuotations, keywords: ["quote statuses", "pipeline", "stages", "quote types", "offer", "technical", "budgetary", "amc", "installation", "text templates", "snippets", "terms", "notes", "email templates", "mail", "subject", "asset print fields", "equipment", "nameplate", "statuses & assets"], adminOnly: true, featureAnyOf: ["quotations", "assets"] },
  { id: "order-types", group: "sales", label: "Order types", description: "The kinds of sales order your workspace takes: numbering, how they are priced, which customers they suit and how the PDF looks", href: ROUTES.settingsOrderTypes, keywords: ["sales order", "orders", "type", "prefix", "numbering", "pdf", "template", "pricing mode"], adminOnly: true, featureKey: "sales_orders", relatedWorkcenter: "sales_orders" },
  { id: "pricing", group: "sales", label: "Pricing", description: "Standard rates for labour, materials, testing and transport, and the way into Dynamic Pricing", href: ROUTES.configPricing, keywords: ["small scale pricing", "rates", "labour", "materials", "dynamic pricing", "pricing engine", "margin", "cost"], adminOnly: true, featureAnyOf: ["quotations", "pricing_engine"] },
  { id: "rfq", group: "sales", label: "RFQ", description: "How requests for quotation reach suppliers and how their replies come back — your own mailbox or BPMSquare's, reply window, reminders and terms", href: ROUTES.settingsRfq, keywords: ["supplier", "request for quotation", "reply"], adminOnly: true, featureKey: "rfq", relatedWorkcenter: "rfqs" },
  { id: "estimate-templates", group: "sales", label: "Estimate templates", description: "The inputs, rates and rule lines that turn a few answers into a bill of materials, a cost build-up and a quote", href: ROUTES.settingsEstimateTemplates, keywords: ["estimator", "estimate", "bom", "rules", "formula", "precast"], adminOnly: true, featureKey: "estimator", relatedWorkcenter: "estimates" },
  { id: "account-360", group: "sales", label: "Account 360", description: "The account drawer: which cards it shows, and the external sources plugged into it", href: ROUTES.settingsAccount360, keywords: ["service", "account drawer", "health", "cards"], adminOnly: true, featureAnyOf: ["next_experience", "spectacular_theme"] },

  // ── Marketing ── (the marketing_scoring program; Consent and Leads are hidden without it)
  { id: "marketing-consent", group: "marketing", label: "Consent", description: "What you may email, the topics people can choose, and when and how often messages may go out", href: ROUTES.settingsMarketingConsent, keywords: ["opt in", "unsubscribe", "gdpr", "pdpl", "permission", "marketing", "topics", "consent topics", "limits", "quiet hours", "opens", "tracking"], adminOnly: true, featureAnyOf: ["marketing_scoring", "newsletter_studio"] },
  { id: "marketing-leads", group: "marketing", label: "Leads", description: "How a lead earns points and when it is ready for sales, then how it reaches a salesperson and who hears when it is overdue", href: ROUTES.settingsMarketingLeads, keywords: ["scoring", "hand-over", "handover", "lead score", "points", "ready for sales", "rubric", "sla", "response time", "overdue", "round robin", "assign", "marketing"], adminOnly: true, featureKey: "marketing_scoring" },

  { id: "brand-kit", group: "marketing", label: "Brand kit", description: "Your logo, colours and email-safe fonts for newsletters", href: ROUTES.settingsBrandKit, keywords: ["newsletter", "logo", "colours", "fonts", "footer", "social"], adminOnly: true, featureKey: "newsletter_studio" },


  // ── Workforce ──
  { id: "workforce", group: "workforce", label: "Workforce", description: "Attendance rules, shifts, places, leave types, alerts and project billing", href: ROUTES.settingsWorkforce, keywords: ["workforce", "attendance", "timezone", "week off", "saturday", "login", "shifts", "grace", "night", "sites", "geofence", "location", "supervisor", "kiosk", "tablet", "face", "selfie", "passkey", "overtime", "work from home", "leave", "quota", "holiday", "carry forward", "reminders", "notifications", "alerts", "push", "email", "employment", "contract", "rates", "projects", "invoice", "billing"], adminOnly: true, featureKey: "wfm", relatedWorkcenter: "wfm" },

  // ── Data ──
  { id: "custom-fields", group: "data", label: "Custom fields", description: "Add fields to any object — included automatically in the API and MCP", href: ROUTES.configCustomFields, keywords: ["fields", "columns", "extra"], adminOnly: true, featureAnyOf: [...CRM_OBJECT_FEATURES, "business_roles"] },
  // featureAnyOf, not featureKey: "products" -- the category tree feeds the products screens AND any field whose
  // selectSource is product_category, which can sit on an object a tenant without the Products module still uses.
  // The Item types tab shows only with the Products module (decided in the page).
  { id: "products", group: "data", label: "Products", description: "The category tree products are filed under, and the kinds of item they can be", href: ROUTES.settingsProducts, keywords: ["product categories", "categories", "tree", "item types", "bom", "kit", "raw material", "finished", "classification"], adminOnly: true, featureAnyOf: ["products", "quotations"], relatedWorkcenter: "quotations" },
  { id: "deletion-log", group: "data", label: "Deleted records", description: "Audit log of permanently deleted objects", href: ROUTES.settingsDeletionLog, keywords: ["audit", "trash", "removed"], adminOnly: true, featureAnyOf: CRM_OBJECT_FEATURES },

  // ── Integrations ──
  { id: "webhooks", group: "integrations", label: "Webhooks", description: "Every webhook in one list: change-feed events and calls fired by a quote award, a record button or a Coverage route", href: ROUTES.settingsWebhooks, keywords: ["webhook", "push", "erp", "integrations", "http", "api", "signing", "headers", "payload", "template"], adminOnly: true, featureKey: "webhooks_library" },
  { id: "middleware", group: "integrations", label: "Integration middleware", description: "Everything about syncing with your ERP in one place: connection, links, mapping, message monitor and resync", href: ROUTES.settingsMiddleware, keywords: ["integrations", "erp", "sync", "dynamics", "sap", "epromis", "connector", "monitor", "mapping", "messages", "resync"], adminOnly: true, featureKey: "integration_middleware" },
  { id: "connectors", group: "integrations", label: "Connectors", description: "Connect Slack, Google Calendar, Gmail, a mail server and Dynamics 365", href: ROUTES.settingsConnectors, keywords: ["slack", "dynamics", "d365"], adminOnly: true },
  { id: "developer", group: "integrations", label: "API keys & developer", description: "Your API key, scoped keys and the address of the API reference", href: ROUTES.settingsDeveloper, keywords: ["general", "api", "rest", "token", "mcp", "openapi", "bearer"], adminOnly: false },
  { id: "push", group: "integrations", label: "Webhooks & push", description: "Event webhooks, and pushing a single record to your ERP on demand", href: ROUTES.settingsPush, keywords: ["erp", "signing secret", "events", "outbound"], adminOnly: true, hiddenWhenFeature: "webhooks_library" },
  { id: "email-output", group: "integrations", label: "Email output", description: "Where quotations, invoices, campaigns and workforce notifications are actually delivered", href: ROUTES.settingsEmailOutput, keywords: ["mail", "redirect", "demo", "inbox", "resend"], adminOnly: true },

  // ── Appearance ──
  { id: "appearance", group: "appearance", label: "Appearance", description: "Theme and colour, which sidebar items show, and the dashboard", href: ROUTES.settingsAppearance, keywords: ["general", "appearance", "theme & colours", "look", "dark", "nova", "classic", "accent", "brand colour", "navigation", "navigation visibility", "sidebar", "menu", "hide", "reset layout", "default", "restore", "dashboard", "dashboard content", "news", "tips", "home"], adminOnly: true },
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
    (!item.hiddenWhenFeature || ctx.features?.[item.hiddenWhenFeature] !== true) &&
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
