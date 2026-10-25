import { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantFeatures } from "@/lib/constants";

/**
 * Object -> the module a tenant has to have bought to see it, anywhere.
 *
 * Written 2026-09-22 after the snasquare workspace showed Cases, Contacts,
 * Assets and Quotations tabs on the Account page despite owning none of
 * those modules. The tabs were one symptom; the audit found the same hole
 * on every v1 API endpoint and every Data Workbench route, because each
 * surface decided for itself which objects a tenant may reach -- and four
 * of them simply never asked.
 *
 * So the question is asked in exactly one place now. The keys are every
 * name any surface uses for an object, including the spellings that differ
 * between surfaces (Data Workbench says `quotes` and `purchase_orders`, v1
 * says `quotations` and `purchase-orders`) -- deliberately listed rather
 * than normalised, so a lookup can never quietly miss.
 *
 * `null` means "deliberately ungated", and each one says why. Anything
 * absent throws: a new object added without a decision here fails the
 * gating test (`objectFeatures.test.ts`) rather than shipping open.
 */
export const OBJECT_FEATURE: Record<string, keyof TenantFeatures | null> = {
  accounts: "accounts",
  assets: "assets",
  cases: "cases",
  contacts: "contacts",
  // Marketing consent ledger (0139): Data Workbench import (a sheet of opt-ins) and export (the
  // current answers). Platform-admin flag; the routes also need the `marketing` module.
  consents: "marketing_scoring",
  // Employees ship as part of the Business Roles/Business Users module --
  // same key the nav item uses (constants.ts NAV).
  employees: "business_roles",
  // Project Estimator (0131). Header records only on the bulk surfaces; the
  // v1 API exposes no cost fields (docs/estimator-architecture.md section 7).
  estimates: "estimator",
  // Shared Inbox (0214). In-app routes only, on purpose: mail is private correspondence, so there is no Data Workbench
  // route, no v1 endpoint and no LIST_SOURCES entry. These keys exist for the surfaces that name the object (Nova
  // comments, the change history) and so the map already says who owns it.
  inbox: "inbox",
  inbound_emails: "inbox",
  inbox_channels: "inbox",
  // Process Design Studio (0152). In-app routes only in phase 1: no Data
  // Workbench route and no v1 endpoint yet (doc section 9.5, phase 3).
  process_studies: "process_studio",
  // Newsletter Studio (0141). Platform-admin flag; the studio also needs
  // `marketing`, which every newsletter route checks beside this one.
  newsletters: "newsletter_studio",
  // Buying signals (0175-0179). In-app routes only in the shell: no Data
  // Workbench route and no v1 endpoint yet, so these three keys exist for the
  // day they get one (and so the map already says who owns them).
  signals: "buying_signals",
  account_intent: "buying_signals",
  signal_topics: "buying_signals",
  // Forms (0170). Platform-admin flag; every forms route also checks `marketing`.
  forms: "marketing_forms",
  // ABM (0180-0182). Every spelling a surface uses: the tables, the Data
  // Workbench routes (abm_programs / abm_targets / abm_members) and the v1
  // endpoints (abm-programs / abm-targets).
  abm_programs: "abm",
  abm_target_accounts: "abm",
  abm_buying_group_members: "abm",
  abm_targets: "abm",
  abm_members: "abm",
  "abm-programs": "abm",
  "abm-targets": "abm",
  // Journeys (0165). Platform-admin flag; every journey route also checks `marketing`.
  journeys: "journeys",
  // WhatsApp marketing (0185-0188). Platform-admin flag; every route also checks `marketing`.
  whatsapp_templates: "whatsapp_marketing",
  whatsapp_messages: "whatsapp_marketing",
  "whatsapp-templates": "whatsapp_marketing",
  // Attribution (0190-0192). Platform-admin flag; every route also checks `marketing`.
  // Events (0195-0196). Platform-admin flag; every route also checks `marketing` and `marketing_forms`.
  marketing_events: "marketing_events",
  event_registrations: "marketing_events",
  marketing_touches: "marketing_attribution",
  attribution_results: "marketing_attribution",
  // Inventory is the stock side of Purchasing; it has never had a key of
  // its own, and the nav gates it on `purchasing` too.
  inventory: "purchasing",
  invoices: "invoices",
  // Reachable through /api/v1/ask rather than an endpoint of its own, but
  // it is a LIST_SOURCES object, so it needs a module behind it like any
  // other.
  leads: "leads",
  opportunities: "pipeline",
  // GCC tender deals (0220): a tender is a deal plus one opportunity_tenders row. Platform-admin flag; the routes also need
  // `pipeline`. The names are every spelling a surface uses: the table, the change-history type, the list source.
  opportunity_tender: "gcc_tender",
  opportunity_tenders: "gcc_tender",
  deal_types: "gcc_tender",
  tenders: "gcc_tender",
  approval_requests: "gcc_tender",
  // The tender BOQ (0223): the client's workbook and the per-line price source of a tender deal.
  tender_boq_sources: "gcc_tender",
  tender_boq_lines: "gcc_tender",
  // The Deal Room (0222): internal only, behind its own platform-admin flag.
  deal_rooms: "deal_room",
  deal_room_members: "deal_room",
  deal_room_messages: "deal_room",
  deal_room_files: "deal_room",
  pricing: "pricing_engine",
  products: "products",
  // BOM components (0133) are lines of a product: the Products module owns them.
  product_bom_lines: "products",
  projects: "wfm_projects",
  wfm_projects: "wfm_projects",
  purchase_orders: "purchasing",
  "purchase-orders": "purchasing",
  quotes: "quotations",
  quotations: "quotations",
  // The DW quote-lines object has its own narrower opt-in (a tenant can
  // own Quotations without being allowed to bulk-edit lines).
  quote_lines: "quote_lines_dw",
  rfqs: "rfq",
  // Recorded RFQ award decisions (0224): in-app routes only (no Data Workbench, v1 or list source), owned by the RFQ module.
  rfq_line_awards: "rfq",
  // What a supplier last quoted for a catalog product (0224); written by RFQ awards, read nowhere over an API yet.
  product_suppliers: "products",
  // Standard Quotes (0053): a module of its own, apart from Quotations. The header and its
  // lines are two Data Workbench families, the v1 endpoint says standard-quotes and the
  // scope / list source say standard_quotes -- every spelling a surface uses.
  standard_quotes: "standard_quotes",
  standard_quote_lines: "standard_quotes",
  "standard-quotes": "standard_quotes",
  // Sales Orders (0212): a module of its own (platform-admin flag). The header and its lines are two Data
  // Workbench families; the v1 endpoint is spelled with a dash, the scope and list source with an underscore.
  sales_orders: "sales_orders",
  sales_order_lines: "sales_orders",
  "sales-orders": "sales_orders",
  suppliers: "suppliers",
  work_orders: "work_orders",
  "work-orders": "work_orders",
  // Workspace users are not a sold module -- they are how anyone
  // administers the workspace at all. Gated on `administration` for the
  // same reason the nav item is.
  users: "administration",
};

/** The feature a surface must check before exposing `object`. Throws on an
 *  object nobody has decided about, which is the point. */
export function featureForObject(object: string): keyof TenantFeatures | null {
  if (!(object in OBJECT_FEATURE)) {
    throw new Error(
      `No feature mapping for object "${object}". Add it to OBJECT_FEATURE in src/lib/objectFeatures.ts before exposing it on any surface.`
    );
  }
  return OBJECT_FEATURE[object];
}

/** Does this tenant own the module that owns `object`? */
export async function tenantOwnsObject(tenantId: string, object: string): Promise<boolean> {
  return (await tenantObjectAccess(tenantId, object)).owned;
}

/**
 * The same single features read as tenantOwnsObject, keeping the flag the v1
 * call log needs (integration_middleware) so logging an API call costs a
 * workspace without the flag no extra query.
 */
export async function tenantObjectAccess(tenantId: string, object: string): Promise<{ owned: boolean; middleware: boolean }> {
  const key = featureForObject(object);
  if (key === null) return { owned: true, middleware: false };
  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("features")
    .eq("id", tenantId)
    .maybeSingle();
  const f = data?.features as TenantFeatures | undefined;
  return { owned: !!f?.[key], middleware: f?.integration_middleware === true };
}

/**
 * API-route guard. Returns a ready-to-return 404 when the tenant does not
 * own the module, or null to continue.
 *
 * 404 and not 403 on purpose (bpmsquarecore §3b): a tenant without the
 * module should not learn the endpoint exists.
 *
 *   const gate = await assertObjectFeature(tenantId, "products");
 *   if (gate) return gate;
 */
export async function assertObjectFeature(
  tenantId: string,
  object: string
): Promise<Response | null> {
  if (await tenantOwnsObject(tenantId, object)) return null;
  return Response.json({ error: "Not found" }, { status: 404 });
}
