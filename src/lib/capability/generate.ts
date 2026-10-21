import type { NavGroup, TenantFeatures } from "@/lib/constants";
import type { SettingsGroupId, SettingsMenuEntry } from "@/lib/settingsMenu";
import type { ObjectFieldRegistry, PilotObjectType } from "@/lib/fieldRegistry";
import type { FeatureDependency } from "@/lib/moduleDependencies";

// The capability catalogue (docs/process-design-studio-architecture.md section 5):
// a list of what BPMSquare really does, GENERATED from the code the product
// runs on. The model may describe a client's business freely, but it can only
// say "BPMSquare does this" by choosing an entry from this list. Pure: every
// input is passed in (capability/catalog.ts wires the real ones), so the
// generator is unit-tested without a database or a model.
//
// Code can say THAT something exists, not what it is for in plain words, so each
// module's sentence and rules are hand-written in docs/capabilities/<module>.md
// and read by scripts/build-capability-facts.mjs. A module without one fails
// capability/catalog.test.ts -- that is how the plain words cannot drift.

export type CapabilityKind =
  | "module" | "screen" | "object" | "field" | "setting" | "api" | "mcp" | "connector" | "extension_point" | "rule";
export type CapabilityStatus = "live" | "experimental" | "coming";

export type CapabilityEntry = {
  /** Stable. Never renamed once shipped: studies cite it. */
  id: string;
  kind: CapabilityKind;
  /** The word the client sees. */
  label: string;
  plain: string;
  /** The TenantFeatures key that owns it, or null when it belongs to the platform. */
  module: string | null;
  needs: string[];
  /** Where a person finds it in the product, in words. */
  where: string | null;
  /** The file it was generated from. */
  source: string;
  status: CapabilityStatus;
  /** A limitation that must travel with the entry; it caps a rating at "partly". */
  caveat?: string;
};

export type ModuleDoc = { status: CapabilityStatus; plain: string; rules: string[] };

export type Facts = {
  features: { key: string; comment: string }[];
  extensionHooks: { name: string; doc: string }[];
  mcp: { version: string; tools: { name: string; description: string }[] };
  capabilityDocs: Record<string, ModuleDoc>;
};

export type CatalogInputs = {
  facts: Facts;
  nav: NavGroup[];
  settingsGroups: { id: SettingsGroupId; label: string }[];
  settings: SettingsMenuEntry[];
  registry: Record<PilotObjectType, ObjectFieldRegistry>;
  listSources: { key: string; label: string; description: string; feature: string | null }[];
  connectors: { id: string; name: string; description: string }[];
  dependencies: FeatureDependency[];
};

type Key = keyof TenantFeatures;

/** Display names for every module flag. Record<Key,...> makes a new flag a compile error until named. */
export const MODULE_LABEL: Record<Key, string> = {
  leads: "Leads", pipeline: "Pipeline", amc: "AMC contracts", dispatch: "Dispatch", invoices: "Invoices",
  partners: "Partners", ai_assistant: "AI assistant", db_export: "Data export", purchasing: "Purchase orders and inventory",
  marketing: "Marketing campaigns", change_history: "Change history", outbound_email: "Outbound email",
  business_roles: "Business roles and employees", standard_quotes: "Standard Quotes", gmail_reply_threading: "Gmail reply threading",
  quote_lines_dw: "Quote lines in the Data Workbench", wfm: "Workforce", wfm_projects: "Workforce project costing",
  accounts: "Accounts", contacts: "Contacts", quotations: "Quotations", cases: "Cases", work_orders: "Work orders",
  technicians: "Technicians", assets: "Assets", suppliers: "Suppliers", products: "Products", reports: "Analytics",
  data_workbench: "Data Workbench", administration: "Administration", pricing_engine: "Dynamic pricing",
  pricing_engine_quotes: "Live prices on quote lines", next_experience: "Nova", enterprise_theme: "Enterprise theme",
  spectacular_theme: "Spectacular theme", coverage_model: "Coverage", ai_reports: "AI report builder",
  fence_projects: "Fence projects", rfq: "RFQs", estimator: "Estimates", process_studio: "Process Design Studio",
  marketing_scoring: "Marketing scoring and consent", newsletter_studio: "Newsletter Studio", buying_signals: "Buying signals", marketing_forms: "Forms and preference centre", abm: "ABM programs", journeys: "Journeys", whatsapp_marketing: "WhatsApp marketing", marketing_attribution: "Revenue by campaign", marketing_events: "Marketing events", integration_middleware: "Integration middleware", webhooks_library: "Webhooks library",
};

/** Which module owns each field-registry object type. Record<PilotObjectType,...> keeps it complete. */
export const OBJECT_MODULE: Record<PilotObjectType, Key> = {
  account: "accounts", contact: "contacts", asset: "assets", supplier: "suppliers",
  case: "cases", work_order: "work_orders", quote: "quotations", invoice: "invoices",
  purchase_order: "purchasing", inventory: "purchasing", employee: "business_roles", product: "products",
  project: "wfm_projects", opportunity: "pipeline", rfq: "rfq", estimate: "estimator", process_study: "process_studio", newsletter: "newsletter_studio", abm_program: "abm", abm_target: "abm", abm_member: "abm",
};

/** Limitations that must travel with a connector. The D365 one is the owner's: it stays visible as it is. */
const CONNECTOR_CAVEAT: Record<string, string> = {
  dynamics365: "Built, but it has not yet run against a live environment with a client.",
};

export const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

const titleCase = (s: string): string => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const clip = (s: string, n = 200): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function navLeaves(nav: NavGroup[]): { path: string[]; href: string; featureKey?: string }[] {
  const out: { path: string[]; href: string; featureKey?: string }[] = [];
  for (const g of nav) {
    for (const item of g.items) {
      if (item.children?.length) {
        for (const ch of item.children) out.push({ path: [item.label, ch.label], href: ch.href, featureKey: ch.featureKey });
      } else {
        out.push({ path: [item.label], href: item.href, featureKey: item.featureKey });
      }
    }
  }
  return out;
}

export function buildCapabilityCatalog(inp: CatalogInputs): CapabilityEntry[] {
  const out: CapabilityEntry[] = [];
  const docs = inp.facts.capabilityDocs;
  const leaves = navLeaves(inp.nav);
  const needsOf = (key: string): string[] => inp.dependencies.filter((d) => d.key === key).map((d) => d.needs);
  const statusOf = (module: string | null): CapabilityStatus => (module ? docs[module]?.status ?? "live" : "live");

  // Modules: one per TenantFeatures flag.
  for (const f of inp.facts.features) {
    const doc = docs[f.key];
    const nav = leaves.find((l) => l.featureKey === f.key);
    const setting = inp.settings.find((s) => s.featureKey === f.key);
    const where = nav ? nav.path.join(" → ") : setting ? `Settings → ${groupLabel(inp, setting.group)} → ${setting.label}` : null;
    out.push({
      id: `cap.module.${f.key}`,
      kind: "module",
      label: MODULE_LABEL[f.key as Key] ?? titleCase(f.key),
      plain: doc?.plain || f.comment,
      module: f.key,
      needs: needsOf(f.key),
      where,
      source: "src/lib/constants.ts#TenantFeatures",
      status: doc?.status ?? "live",
    });
    for (const rule of doc?.rules ?? []) {
      out.push({
        id: `cap.rule.${f.key}.${slug(rule)}`, kind: "rule", label: clip(rule, 80), plain: rule,
        module: f.key, needs: [], where, source: `docs/capabilities/${f.key}.md`, status: statusOf(f.key),
      });
    }
  }

  // Screens: every leaf of the sidebar.
  for (const l of leaves) {
    const label = l.path[l.path.length - 1];
    const mod = l.featureKey ?? null;
    out.push({
      id: `cap.screen.${slug(l.href)}`, kind: "screen", label,
      plain: `${label}${mod && docs[mod] ? `: ${docs[mod].plain}` : ""}`,
      module: mod, needs: [], where: l.path.join(" → "), source: "src/lib/constants.ts#NAV", status: statusOf(mod),
    });
  }

  // Settings pages.
  for (const s of inp.settings) {
    const mod = s.featureKey ?? s.featureAnyOf?.[0] ?? null;
    out.push({
      id: `cap.setting.${slug(s.id)}`, kind: "setting", label: s.label, plain: s.description, module: mod, needs: [],
      where: `Settings → ${groupLabel(inp, s.group)} → ${s.label}`, source: "src/lib/settingsMenu.ts", status: statusOf(mod),
    });
  }

  // Objects and their standard fields.
  for (const [type, reg] of Object.entries(inp.registry) as [PilotObjectType, ObjectFieldRegistry][]) {
    const mod = OBJECT_MODULE[type];
    const label = titleCase(type);
    const shown = reg.fields.filter((f) => !f.exportOnly);
    out.push({
      id: `cap.object.${type}`, kind: "object", label,
      plain: `${docs[mod]?.plain ?? label}. Standard fields: ${shown.slice(0, 8).map((f) => f.defaultLabel).join(", ")}${shown.length > 8 ? ", and more" : ""}.`,
      module: mod, needs: [], where: null, source: `src/lib/fieldRegistry.ts (${type})`, status: statusOf(mod),
    });
    for (const f of shown) {
      out.push({
        id: `cap.field.${type}.${f.key}`, kind: "field", label: `${label}: ${f.defaultLabel}`,
        plain: `A standard ${f.widget} field "${f.defaultLabel}" on ${label.toLowerCase()} records, in the ${f.defaultSection} section.`,
        module: mod, needs: [], where: null, source: `src/lib/fieldRegistry.ts (${type})`, status: statusOf(mod),
      });
    }
  }

  // REST API.
  out.push({
    id: "cap.api.v1", kind: "api", label: "REST API and webhooks",
    plain: "Scoped API keys, filtered and enriched queries, an OpenAPI description, a change feed, webhooks on changes, an ask endpoint, and pushing a record to an ERP on demand.",
    module: null, needs: [], where: "Settings → Integrations", source: "src/lib/api/listSources.ts", status: "live",
  });
  for (const ls of inp.listSources) {
    out.push({
      id: `cap.api.${slug(ls.key)}`, kind: "api", label: `${ls.label} in the API`, plain: clip(ls.description),
      module: ls.feature, needs: [], where: "REST API", source: "src/lib/api/listSources.ts", status: statusOf(ls.feature),
    });
  }

  // MCP tools.
  for (const t of inp.facts.mcp.tools) {
    out.push({
      id: `cap.mcp.${slug(t.name)}`, kind: "mcp", label: t.name, plain: t.description, module: null, needs: [],
      where: "MCP server", source: "mcp-server/mcp.json", status: "live",
    });
  }

  // Connectors.
  for (const c of inp.connectors) {
    const caveat = CONNECTOR_CAVEAT[c.id];
    out.push({
      id: `cap.connector.${slug(c.id)}`, kind: "connector", label: c.name,
      plain: caveat ? `${caveat} ${clip(c.description, 260)}` : clip(c.description, 320),
      module: null, needs: [], where: "Settings → Integrations → Connectors", source: "src/lib/connectors/registry.ts", status: "live",
      ...(caveat ? { caveat } : {}),
    });
  }

  // Extension points.
  for (const h of inp.facts.extensionHooks) {
    out.push({
      id: `cap.extension.${slug(h.name)}`, kind: "extension_point", label: h.name,
      plain: `A hook a workspace-specific extension can use: ${h.doc}`, module: null, needs: [],
      where: null, source: "src/extensions/types.ts", status: "live",
    });
  }

  return out;
}

function groupLabel(inp: CatalogInputs, id: SettingsGroupId): string {
  return inp.settingsGroups.find((g) => g.id === id)?.label ?? titleCase(id);
}

/** Module flags that have no hand-written plain-words entry. capability/catalog.test.ts fails the build when this is not empty. */
export function missingPlainWords(facts: Pick<Facts, "features" | "capabilityDocs">): string[] {
  return facts.features.filter((f) => !facts.capabilityDocs[f.key]?.plain?.trim()).map((f) => f.key);
}
