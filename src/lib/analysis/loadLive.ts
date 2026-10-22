import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canUseObject, type AssistantCtx } from "@/lib/assistant/sources";
import { objectDef } from "@/lib/assistant/objects";
import { resolveCoverageForAccount } from "@/lib/coverage/resolve";
import { loadAccountSignals, ownerNames } from "@/lib/signals/queries";
import { resolveCurrency, formatMoneyCompact } from "@/lib/currency";
import type { Account } from "@/lib/types";
import type { TenantConfig } from "@/lib/constants";
import { assembleInSystem, dayMonth, type InSystemRaw } from "./inSystem";
import { resolveFitWeights } from "./fit";
import type { LiveInputs } from "./compose";
import type { Subject } from "./subject";
import type { InSystem } from "./types";

// The live half of the card: everything read from the workspace's own tables on every render, with the tenant in every
// filter and only the objects this person may view (module on AND Business Role view). No web, no cache. A query that
// fails (table missing, module not migrated) reads as "nothing here" and never stops the analysis.

export type LiveCtx = AssistantCtx & { admin: SupabaseClient; config: Partial<TenantConfig>; now: Date };

export type AccountRow = {
  id: string; name: string; type: string | null; website: string | null; city: string | null; country: string | null;
  industry: string | null; owner_user_id: string | null; created_at: string | null;
};

export const ACCOUNT_COLUMNS = "id, name, type, website, city, country, industry, owner_user_id, created_at";

type Row = Record<string, unknown>;

async function rows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[] | null> {
  try {
    const { data, error } = await q;
    return error ? null : ((data ?? []) as Row[]);
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export async function loadInSystemRaw(c: LiveCtx, account: AccountRow | null, subject: Subject): Promise<InSystemRaw> {
  const { admin, tenantId } = c;
  const can = (t: Parameters<typeof objectDef>[0]) => canUseObject(c, objectDef(t));
  const id = account?.id ?? null;
  const cur = resolveCurrency(c.config as { currency?: string | null });
  const raw: InSystemRaw = {
    account: null, contacts: null, quotes: null, deals: null, cases: null, invoices: null, lastActivity: null, accountNames: null,
    subject: { name: subject.name, domain: subject.domain }, now: c.now, formatValue: (n) => formatMoneyCompact(n, cur),
  };

  if (!account) {
    raw.accountNames = ((await rows(admin.from("accounts").select("id, name, website").eq("tenant_id", tenantId).limit(1000))) ?? [])
      .map((r) => ({ id: String(r.id), name: String(r.name), website: str(r.website) }));
    return raw;
  }

  const owners = account.owner_user_id ? await ownerNames(admin, [account.owner_user_id]) : new Map<string, string>();
  raw.account = { id: account.id, name: account.name, type: account.type, owner: account.owner_user_id ? (owners.get(account.owner_user_id) ?? null) : null, createdAt: account.created_at };

  const jobs: Promise<void>[] = [];
  if (can("contact")) {
    jobs.push((async () => {
      const r = await rows(admin.from("contacts").select("id, name, role, department").eq("tenant_id", tenantId).eq("account_id", id!).limit(50));
      if (r) raw.contacts = r.map((x) => ({ id: String(x.id), name: String(x.name), title: str(x.role), department: str(x.department) }));
    })());
  }
  if (can("quote")) {
    jobs.push((async () => {
      const r = await rows(admin.from("quotes").select("id, ref, total, created_at").eq("tenant_id", tenantId).eq("account_id", id!).eq("outcome", "open").limit(50));
      if (r) raw.quotes = r.map((x) => ({ id: String(x.id), ref: str(x.ref), total: num(x.total), createdAt: str(x.created_at) }));
    })());
  }
  if (can("opportunity")) {
    jobs.push((async () => {
      const r = await rows(admin.from("opportunities").select("id, title, amount, stage").eq("tenant_id", tenantId).eq("account_id", id!).eq("outcome", "open").limit(50));
      if (r) raw.deals = r.map((x) => ({ id: String(x.id), title: str(x.title), amount: num(x.amount), stage: str(x.stage) }));
    })());
  }
  if (can("case")) {
    jobs.push((async () => {
      const r = await rows(admin.from("service_cases").select("id, ref, status").eq("tenant_id", tenantId).eq("account_id", id!).not("status", "in", "(closed,scrapped,buyback)").limit(50));
      if (r) raw.cases = r.map((x) => ({ id: String(x.id), ref: str(x.ref), status: str(x.status) }));
    })());
  }
  if (can("invoice")) {
    jobs.push((async () => {
      const r = await rows(admin.from("invoices").select("id, ref, total, paid_amount, due_date, status").eq("tenant_id", tenantId).eq("account_id", id!).in("status", ["sent", "partial", "overdue"]).limit(100));
      if (r) raw.invoices = r.map((x) => ({ id: String(x.id), ref: str(x.ref), total: num(x.total), paid: num(x.paid_amount), dueDate: str(x.due_date), status: str(x.status) }));
    })());
  }
  await Promise.all(jobs);

  // Last activity: the newest of the latest quote, deal and case the person may see.
  const latest: { text: string; date: string; href?: string }[] = [];
  const last = async (table: string, col: string, label: string, ref: string, href: (i: string) => string, allowed: boolean) => {
    if (!allowed) return;
    const r = await rows(admin.from(table).select(`id, ${ref}, ${col}`).eq("tenant_id", tenantId).eq("account_id", id!).order(col, { ascending: false }).limit(1));
    const x = r?.[0];
    if (x && str(x[col])) latest.push({ text: `${label} ${str(x[ref]) ?? ""}`.trim(), date: String(x[col]), href: href(String(x.id)) });
  };
  await Promise.all([
    last("quotes", "created_at", "Quote", "ref", (i) => `/quotations/${i}`, can("quote")),
    last("opportunities", "created_at", "Deal", "ref", (i) => `/pipeline/${i}`, can("opportunity")),
    last("service_cases", "intake_at", "Case", "ref", (i) => `/cases/${i}`, can("case")),
  ]);
  latest.sort((a, b) => b.date.localeCompare(a.date));
  if (latest[0]) raw.lastActivity = { text: `${latest[0].text}, ${dayMonth(latest[0].date)}`, date: latest[0].date, href: latest[0].href };
  return raw;
}

export async function loadLive(c: LiveCtx, account: AccountRow | null, subject: Subject): Promise<LiveInputs> {
  const { admin, tenantId } = c;
  const inSystemRaw = await loadInSystemRaw(c, account, subject);
  const inSystem: InSystem = assembleInSystem(inSystemRaw);

  const termRows = await Promise.all([
    rows(admin.from("signal_topics").select("name").eq("tenant_id", tenantId).eq("enabled", true).limit(100)),
    rows(admin.from("segments").select("name").eq("tenant_id", tenantId).limit(100)),
  ]);
  const terms = [...new Set(termRows.flatMap((r) => (r ?? []).map((x) => String(x.name))))];

  let intent: LiveInputs["intent"] = null;
  let notInMarket = false;
  if (account && c.features.buying_signals === true) {
    const s = await loadAccountSignals({ admin, tenantId }, account.id, c.now).catch(() => null);
    if (s && s.computed_at) {
      intent = { score: s.score, stage: s.stage, factors: s.factors };
      notInMarket = s.held;
    }
  }

  let coverage: LiveInputs["coverage"] = null;
  if (account) {
    try {
      const { data } = await admin.from("accounts").select("*").eq("id", account.id).eq("tenant_id", tenantId).maybeSingle();
      if (data) {
        const cov = await resolveCoverageForAccount(tenantId, data as Account);
        coverage = { covered: !!cov.owner, where: account.city ?? account.country ?? undefined, team: cov.owner?.team.name };
      }
    } catch { /* coverage is one factor; without it the fit simply has less to go on */ }
  }

  let customer: LiveInputs["customer"] = null;
  if (account && canUseObject(c, objectDef("quote"))) {
    const won = await rows(admin.from("quotes").select("created_at").eq("tenant_id", tenantId).eq("account_id", account.id).eq("outcome", "won").order("created_at", { ascending: true }).limit(1));
    if (won) customer = won.length > 0 ? { since: String(won[0].created_at).slice(0, 4) } : null;
  }

  const cfg = c.config.company_analysis;
  return { intent, inSystem, coverage, terms, sizeBand: cfg?.size_band ?? null, customer, notInMarket, weights: resolveFitWeights(cfg?.fit_weights) };
}
