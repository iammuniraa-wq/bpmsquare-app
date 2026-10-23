import type { WorkcenterKey } from "@/lib/workcenters";

// The "New <object>" targets the ⌘K palette offers, kept in one place so the
// assistant's navigation cards are generated from the very same list (a create
// target the palette does not know about does not exist for the assistant
// either). `workcenterKey` is the workcenter whose create grant the target
// needs; the palette itself has always gated on the module flag only, the
// assistant additionally requires the grant.
export type CreateAction = { label: string; href: string; featureKey: string; workcenterKey?: WorkcenterKey };

export const CREATE_ACTIONS: CreateAction[] = [
  { label: "New Account",   href: "/accounts/new",    featureKey: "accounts", workcenterKey: "accounts" },
  { label: "New Contact",   href: "/contacts/new",    featureKey: "contacts", workcenterKey: "contacts" },
  { label: "New Quotation", href: "/quotations/new",  featureKey: "quotations", workcenterKey: "quotations" },
  { label: "New Standard Quote", href: "/standard-quotes/new", featureKey: "standard_quotes", workcenterKey: "standard_quotes" },
  { label: "New Asset",     href: "/assets/new",      featureKey: "assets", workcenterKey: "assets" },
  { label: "New Supplier",  href: "/suppliers/new",   featureKey: "suppliers", workcenterKey: "suppliers" },
  { label: "New Product",   href: "/products/new",    featureKey: "products", workcenterKey: "products" },
  { label: "New Deal",      href: "/pipeline/new",    featureKey: "pipeline", workcenterKey: "pipeline" },
  { label: "New RFQ",       href: "/rfqs/new",        featureKey: "rfq", workcenterKey: "rfqs" },
  { label: "New Estimate",  href: "/estimates/new",   featureKey: "estimator", workcenterKey: "estimates" },
  { label: "New Study",     href: "/process-studio/new", featureKey: "process_studio", workcenterKey: "process_studio" },
  { label: "New Newsletter", href: "/marketing/newsletters/new", featureKey: "newsletter_studio", workcenterKey: "marketing_newsletters" },
  { label: "New ABM program", href: "/marketing/abm/new", featureKey: "abm", workcenterKey: "abm" },
  { label: "New Journey",   href: "/marketing/journeys/new", featureKey: "journeys", workcenterKey: "marketing_journeys" },
  { label: "New Project",   href: "/wfm/projects/new", featureKey: "wfm_projects", workcenterKey: "wfm" },
  { label: "New Technician", href: "/technicians/new", featureKey: "technicians", workcenterKey: "technicians" },
];
