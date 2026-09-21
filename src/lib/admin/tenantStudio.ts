import "server-only";

import { WORKCENTERS, type WorkcenterKey } from "@/lib/workcenters";
import { NAV, type TenantFeatures } from "@/lib/constants";
import { isCurrencyCode, DEFAULT_CURRENCY, type CurrencyCode } from "@/lib/currency";

/**
 * TENANT CREATION STUDIO — the plan, and the rules a plan must obey.
 *
 * The studio lets a platform admin onboard a client by describing it
 * ("Qatar fencing contractor, 40 on site, workforce plus quotations, two
 * supervisors") and refining by saying more. This file is the half that
 * cannot be talked out of anything.
 *
 * ── THE ONE INVARIANT ─────────────────────────────────────────────────────
 * The model PROPOSES; this file DECIDES; the apply route WRITES. Nothing the
 * model emits reaches the database on trust:
 *
 *   - feature flags are intersected with FEATURE_KEYS, the real
 *     TenantFeatures shape;
 *   - workcenter grants with the WORKCENTERS catalog;
 *   - nav hrefs with the real NAV tree;
 *   - the currency with isCurrencyCode();
 *   - the slug and domain with regexes, and the slug is what the tenant is
 *     addressed by forever, so it is never "close enough";
 *   - anything unrecognised is DROPPED and reported as a warning, never
 *     passed through and never silently corrected into something plausible.
 *
 * That is why normalisePlan() returns warnings rather than throwing: an
 * admin needs to see "I ignored the module `crm_plus`, there is no such
 * thing" before pressing Create, not a 400 with the plan lost.
 *
 * ── WHAT IT DELIBERATELY CANNOT DO ────────────────────────────────────────
 * Three provisioning steps are outside the app and stay outside it (see
 * TENANT_PROVISIONING.md §2): adding the domain in Vercel, the DNS CNAME,
 * and the Supabase Auth redirect allowlist. A tenant is unreachable until a
 * human does those, so manualSteps() emits them as a checklist with the
 * exact values rather than letting the studio imply the job is finished.
 */

/** Runtime mirror of TenantFeatures. A key here that isn't on the type (or
 *  the reverse) is a compile error, via FEATURE_KEYS' satisfies clause. */
export const FEATURE_KEYS = [
  "accounts", "contacts", "quotations", "cases", "work_orders", "technicians",
  "assets", "suppliers", "reports", "data_workbench", "administration",
  "leads", "pipeline", "amc", "dispatch", "invoices", "partners",
  "ai_assistant", "db_export", "purchasing", "marketing", "products",
  "change_history", "outbound_email", "business_roles", "standard_quotes",
  "gmail_reply_threading", "quote_lines_dw", "wfm", "wfm_projects",
  "pricing_engine", "pricing_engine_quotes", "coverage_model", "ai_reports",
  "fence_projects",
] as const satisfies readonly (keyof TenantFeatures)[];

/** Platform-admin-only flags. The studio must never switch one on from a
 *  typed description: they gate unreleased experience layers, and
 *  bpmsquarecore.md §10 rule 1 is that nothing experimental reaches a client
 *  tenant without the owner's explicit go. They are set in /admin/tenants/[id]
 *  afterwards, deliberately by hand. */
export const EXPERIMENTAL_FEATURE_KEYS: readonly string[] = [
  "next_experience", "enterprise_theme", "spectacular_theme",
];

/** The runbook's package table (TENANT_PROVISIONING.md §0), as data. */
export const PACKAGES = {
  wfm_only: {
    label: "Workforce only",
    features: ["wfm", "business_roles", "administration", "reports", "data_workbench"],
  },
  full_crm: {
    label: "Full CRM",
    features: [
      "accounts", "contacts", "quotations", "cases", "work_orders", "technicians",
      "assets", "suppliers", "reports", "data_workbench", "administration",
    ],
  },
} as const;

export type StudioRole = {
  name: string;
  description?: string;
  workcenters: { key: WorkcenterKey; can_view: boolean; can_edit: boolean }[];
};

export type StudioUser = {
  email: string;
  role: "admin" | "member";
  business_role?: string;
  employee?: {
    first_name: string;
    last_name?: string;
    wfm_role?: "supervisor" | "employee";
    designation?: string;
  };
};

export type TenantStudioPlan = {
  tenant: {
    name: string;
    slug: string;
    custom_domain: string;
    currency: CurrencyCode;
    plan: string;
    accent_color: string;
  };
  package: keyof typeof PACKAGES | "custom";
  features: Partial<TenantFeatures>;
  nav_hidden_hrefs: string[];
  admin: { email: string; password?: string };
  roles: StudioRole[];
  users: StudioUser[];
  /** The model's own account of what it assumed and why -- shown, never acted on. */
  notes: string[];
};

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const WORKCENTER_KEYS = new Set<string>(WORKCENTERS.map((w) => w.key));

/** Every href the nav actually renders, parents and children alike. */
function navHrefs(): Set<string> {
  const out = new Set<string>();
  for (const group of NAV) {
    for (const item of group.items) {
      out.add(item.href);
      for (const child of item.children ?? []) out.add(child.href);
    }
  }
  return out;
}

export type NormalisedPlan = { plan: TenantStudioPlan; warnings: string[] };

/**
 * Turn whatever the model produced into a plan this codebase will accept, or
 * say precisely what it threw away. Never throws: a half-usable plan with
 * warnings is worth more to the operator than a rejection.
 */
export function normalisePlan(raw: unknown): NormalisedPlan {
  const warnings: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const t = (r.tenant ?? {}) as Record<string, unknown>;

  const name = String(t.name ?? "").trim().slice(0, 120);
  let slug = String(t.slug ?? "").trim().toLowerCase();
  if (slug && !SLUG_RE.test(slug)) {
    // Repaired rather than dropped: the slug is derivable from the name, and
    // an operator who has to retype it for a stray capital learns nothing.
    const repaired = slug.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);
    warnings.push(`Slug "${slug}" isn't a valid slug; using "${repaired}".`);
    slug = SLUG_RE.test(repaired) ? repaired : "";
  }

  let domain = String(t.custom_domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (domain && !DOMAIN_RE.test(domain)) {
    warnings.push(`Domain "${domain}" isn't a valid hostname — left blank for you to set.`);
    domain = "";
  }

  const currencyRaw = String(t.currency ?? "").trim().toUpperCase();
  const currency: CurrencyCode = isCurrencyCode(currencyRaw) ? currencyRaw : DEFAULT_CURRENCY;
  if (currencyRaw && !isCurrencyCode(currencyRaw)) {
    warnings.push(`"${currencyRaw}" isn't a supported currency; using ${DEFAULT_CURRENCY}.`);
  }

  const accentRaw = String(t.accent_color ?? "").trim();
  const accent_color = HEX_RE.test(accentRaw) ? accentRaw : "#F47C20";

  // ── features ──
  const pkgRaw = String(r.package ?? "custom");
  const pkg = (pkgRaw === "wfm_only" || pkgRaw === "full_crm") ? pkgRaw : "custom";
  const features: Partial<TenantFeatures> = {};
  const featIn = (r.features ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(featIn)) {
    if (EXPERIMENTAL_FEATURE_KEYS.includes(key)) {
      if (value === true) warnings.push(`Ignored "${key}" — experimental flags are set by hand in /admin/tenants, never from a description.`);
      continue;
    }
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) {
      warnings.push(`Ignored unknown module "${key}".`);
      continue;
    }
    (features as Record<string, boolean>)[key] = value === true;
  }
  // business_roles is mandatory whenever WFM is on (runbook §0: employee
  // master, Business Users and the auto WFM roles all hang off it).
  if (features.wfm === true && features.business_roles !== true) {
    features.business_roles = true;
    warnings.push("Turned on Business Roles — Workforce requires it (runbook §0).");
  }

  // ── nav visibility ──
  const known = navHrefs();
  const nav_hidden_hrefs: string[] = [];
  for (const href of Array.isArray(r.nav_hidden_hrefs) ? r.nav_hidden_hrefs : []) {
    const h = String(href).trim();
    if (!known.has(h)) { warnings.push(`Ignored nav item "${h}" — no such screen.`); continue; }
    if (!nav_hidden_hrefs.includes(h)) nav_hidden_hrefs.push(h);
  }

  // ── the provisioning admin ──
  const adminIn = (r.admin ?? {}) as Record<string, unknown>;
  let adminEmail = String(adminIn.email ?? "").trim().toLowerCase();
  if (adminEmail && !EMAIL_RE.test(adminEmail)) {
    warnings.push(`"${adminEmail}" isn't a valid email — left blank.`);
    adminEmail = "";
  }
  const adminPassword = typeof adminIn.password === "string" && adminIn.password.length >= 8
    ? adminIn.password : undefined;

  // ── roles ──
  const roles: StudioRole[] = [];
  for (const roleRaw of Array.isArray(r.roles) ? r.roles : []) {
    const ro = (roleRaw ?? {}) as Record<string, unknown>;
    const rName = String(ro.name ?? "").trim().slice(0, 80);
    if (!rName) { warnings.push("Dropped a role with no name."); continue; }
    if (roles.some((x) => x.name.toLowerCase() === rName.toLowerCase())) {
      warnings.push(`Dropped duplicate role "${rName}".`);
      continue;
    }
    const wcs: StudioRole["workcenters"] = [];
    for (const wRaw of Array.isArray(ro.workcenters) ? ro.workcenters : []) {
      const w = (wRaw ?? {}) as Record<string, unknown>;
      const key = String(w.key ?? "").trim();
      if (!WORKCENTER_KEYS.has(key)) { warnings.push(`Role "${rName}": ignored unknown workcenter "${key}".`); continue; }
      if (wcs.some((x) => x.key === key)) continue;
      // A grant row exists to GIVE access, so view is implied by its
      // presence; edit is the only real choice (0052: workcenters are
      // opt-in per role, never opt-out).
      wcs.push({ key: key as WorkcenterKey, can_view: true, can_edit: w.can_edit === true });
    }
    if (wcs.length === 0) {
      warnings.push(`Role "${rName}" grants nothing — kept, but it will show an empty workspace until you add workcenters.`);
    }
    roles.push({ name: rName, description: String(ro.description ?? "").trim().slice(0, 240) || undefined, workcenters: wcs });
  }

  // ── users ──
  const users: StudioUser[] = [];
  for (const uRaw of Array.isArray(r.users) ? r.users : []) {
    const u = (uRaw ?? {}) as Record<string, unknown>;
    const email = String(u.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { warnings.push(`Dropped a user with an unusable email ("${String(u.email ?? "")}").`); continue; }
    if (users.some((x) => x.email === email)) { warnings.push(`Dropped duplicate user ${email}.`); continue; }
    const brRaw = String(u.business_role ?? "").trim();
    const br = brRaw && roles.some((x) => x.name.toLowerCase() === brRaw.toLowerCase()) ? brRaw : undefined;
    if (brRaw && !br) warnings.push(`${email}: no role named "${brRaw}" in this plan, so no Business Role was attached.`);
    const empIn = (u.employee ?? null) as Record<string, unknown> | null;
    let employee: StudioUser["employee"];
    if (empIn) {
      const first = String(empIn.first_name ?? "").trim().slice(0, 60);
      if (first) {
        const wfmRole = empIn.wfm_role === "supervisor" ? "supervisor" as const : "employee" as const;
        employee = {
          first_name: first,
          last_name: String(empIn.last_name ?? "").trim().slice(0, 60) || undefined,
          wfm_role: wfmRole,
          designation: String(empIn.designation ?? "").trim().slice(0, 80) || undefined,
        };
      } else {
        warnings.push(`${email}: employee record needs a first name, so none was created.`);
      }
    }
    if (employee && features.wfm !== true) {
      warnings.push(`${email}: employee records need the Workforce module, which this plan doesn't include — created as a login only.`);
      employee = undefined;
    }
    users.push({ email, role: u.role === "admin" ? "admin" : "member", business_role: br, employee });
  }

  const notes = (Array.isArray(r.notes) ? r.notes : [])
    .map((n) => String(n).trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 8);

  return {
    plan: {
      tenant: { name, slug, custom_domain: domain, currency, plan: String(t.plan ?? "starter").trim().slice(0, 40) || "starter", accent_color },
      package: pkg,
      features,
      nav_hidden_hrefs,
      admin: { email: adminEmail, password: adminPassword },
      roles,
      users,
      notes,
    },
    warnings,
  };
}

/** What still has to be done by a human, with the values already filled in. */
export function manualSteps(plan: TenantStudioPlan): { title: string; detail: string }[] {
  const host = plan.tenant.custom_domain || "<domain>";
  const sub = host.split(".")[0];
  return [
    {
      title: "Add the domain in Vercel",
      detail: `Project bpmsquare-app (team veveycrm) → Settings → Domains → Add Existing → ${host}. The tenant is unreachable until this and the next step are done.`,
    },
    {
      title: "Add the DNS record",
      detail: `At the DNS provider for bpmsquare.com: CNAME, name "${sub}", target cname.vercel-dns.com. Wait for Vercel to show "Valid Configuration" — while it still says "Generating SSL Certificate" the site is plain HTTP and a login will not stick.`,
    },
    {
      title: "Allow the host in Supabase Auth",
      detail: `Supabase → Authentication → URL Configuration → Redirect URLs must cover https://${host}/**. Without it, password-reset links bounce to the wrong tenant's domain — which presents as "reset loops".`,
    },
    {
      title: "Configure the modules with the client",
      detail: plan.features.wfm === true
        ? "Settings → Workforce, in order: timezone → employment types → punch types + OT rate → punch sites with geofence → shifts → leave types & quotas → holidays → notifications. Punching only works once a site AND a shift exist and are assigned."
        : "Settings → Entities & Tax, number ranges, and each bought module's own settings, with the client admin.",
    },
    {
      title: "Hand over",
      detail: "When the client names their own admin: Settings → Team → add them as Admin, then remove the provisioning alias and any plain-email membership the platform-admin auto-admit created during setup.",
    },
  ];
}
