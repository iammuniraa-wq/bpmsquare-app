import "server-only";
import { diffForLog, logChange } from "@/lib/changeLog";
import { insertWithMasterRef } from "@/lib/masterRef";
import { decrypt } from "@/lib/encryption";
import { topicsOf } from "@/lib/marketing/config";
import { isUuid, type ModuleCtx, type ModuleSpec } from "@/lib/marketing/moduleAccess";
import { isSchemaPending } from "@/lib/marketing/pending";
import { LIMITS, TEMPLATE_STATUSES, cleanText, sanitizeTemplate, type TemplateStatus } from "./template";

// WhatsApp templates and the message log: the signed-in side. Writes use the SERVICE-ROLE client (the tables are
// select-only to members, 0185/0187) after moduleAccess() -> requireTenantUser(); every query names the tenant.

export const WHATSAPP_SPEC: ModuleSpec = { flag: "whatsapp_marketing", workcenter: "marketing_whatsapp", label: "WhatsApp", migrations: "0185 to 0188" };

export type TemplateRecord = {
  id: string; tenant_id: string; ref: string | null; name: string; language: string; category: string; body: string;
  provider_template_name: string | null; status: TemplateStatus; rejection_reason: string | null; approved_at: string | null;
  topic: string | null; created_at: string; updated_at: string;
};

export type Loaded<T> = { data: T | null; missing: boolean };

export async function loadTemplate(ctx: ModuleCtx, id: string): Promise<Loaded<TemplateRecord>> {
  if (!isUuid(id)) return { data: null, missing: false };
  const { data, error } = await ctx.supabase.from("whatsapp_templates").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { data: null, missing: isSchemaPending(error) };
  return { data: (data as TemplateRecord | null) ?? null, missing: false };
}

export type ListParams = { q: string; status: TemplateStatus | null; page: number; page_size: number };

export function parseListParams(sp: URLSearchParams): ListParams {
  const page = Number.parseInt(sp.get("page") ?? "1", 10);
  const status = sp.get("status");
  return {
    q: (sp.get("q") ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 60),
    status: (TEMPLATE_STATUSES as readonly string[]).includes(status ?? "") ? (status as TemplateStatus) : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: 20,
  };
}

export type ListedTemplate = Pick<TemplateRecord, "id" | "ref" | "name" | "language" | "category" | "status" | "updated_at"> & { sent: number };

export async function listTemplates(ctx: ModuleCtx, p: ListParams): Promise<{ rows: ListedTemplate[]; total: number; missing: boolean }> {
  let q = ctx.supabase.from("whatsapp_templates").select("id, ref, name, language, category, status, updated_at", { count: "exact" }).eq("tenant_id", ctx.tenantId);
  if (p.status) q = q.eq("status", p.status);
  else q = q.neq("status", "archived");
  if (p.q) q = q.or(`name.ilike.%${p.q}%,ref.ilike.%${p.q}%`);
  const from = (p.page - 1) * p.page_size;
  const { data, error, count } = await q.order("updated_at", { ascending: false }).order("id").range(from, from + p.page_size - 1);
  if (error) {
    if (isSchemaPending(error)) return { rows: [], total: 0, missing: true };
    throw { status: 500, message: "Could not load templates" };
  }
  const base = (data ?? []) as Omit<ListedTemplate, "sent">[];
  const sent = base.length
    ? await ctx.supabase.from("whatsapp_messages").select("template_id").eq("tenant_id", ctx.tenantId).eq("direction", "out").in("template_id", base.map((r) => r.id)).limit(5000)
    : { data: [] as { template_id: string }[] };
  const counts = new Map<string, number>();
  for (const s of (sent.data ?? []) as { template_id: string }[]) counts.set(s.template_id, (counts.get(s.template_id) ?? 0) + 1);
  return { rows: base.map((r) => ({ ...r, sent: counts.get(r.id) ?? 0 })), total: count ?? base.length, missing: false };
}

const topicKeys = (ctx: ModuleCtx) => topicsOf(ctx.tenant.config).map((t) => t.key);

export async function createTemplate(ctx: ModuleCtx, body: unknown): Promise<{ id: string; ref: string | null } | { missing: true }> {
  const r = sanitizeTemplate(body, topicKeys(ctx));
  if (!r.ok) throw { status: 422, message: r.error };
  const v = r.value;
  const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(ctx.admin, "whatsapp_templates", ctx.tenantId, {
    tenant_id: ctx.tenantId, name: v.name, language: v.language, category: v.category, body: v.body, topic: v.topic,
    provider_template_name: v.provider_template_name, status: "draft", created_by: ctx.userId,
  }, "id, ref");
  if (error || !data) {
    if (error && isSchemaPending(error)) return { missing: true };
    if (error?.code === "23505") throw { status: 409, message: "A template with that name and language already exists." };
    throw { status: 500, message: "Could not save the template" };
  }
  await logChange(ctx.supabase, {
    tenantId: ctx.tenantId, objectType: "whatsapp_templates", objectId: data.id, objectLabel: data.ref ?? v.name,
    action: "create", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "name", from: null, to: v.name }],
  });
  return { id: data.id, ref: data.ref };
}

export type TemplatePatch = { content?: unknown; status?: unknown; rejection_reason?: unknown };

/**
 * Saves the words and/or moves the approval flag. In the shell there is no provider to ask, so a person sets the
 * flag; changing the WORDS of an approved template sends it back to draft (a provider would make you re-submit it).
 */
export async function saveTemplate(ctx: ModuleCtx, id: string, patch: TemplatePatch): Promise<{ status: TemplateStatus } | { missing: true }> {
  const current = await loadTemplate(ctx, id);
  if (current.missing) return { missing: true };
  if (!current.data) throw { status: 404, message: "Template not found" };
  const row = current.data;
  const update: Record<string, unknown> = {};

  if (patch.content !== undefined) {
    const r = sanitizeTemplate(patch.content, topicKeys(ctx));
    if (!r.ok) throw { status: 422, message: r.error };
    const v = r.value;
    Object.assign(update, { name: v.name, language: v.language, category: v.category, body: v.body, topic: v.topic, provider_template_name: v.provider_template_name });
    if (row.status === "approved" && (v.body !== row.body || v.language !== row.language || v.category !== row.category)) {
      Object.assign(update, { status: "draft", approved_at: null });
    }
  }
  if (patch.status !== undefined) {
    if (typeof patch.status !== "string" || !(TEMPLATE_STATUSES as readonly string[]).includes(patch.status)) throw { status: 422, message: "Unknown status" };
    const next = patch.status as TemplateStatus;
    if (next === "approved" && ctx.role !== "admin") throw { status: 403, message: "Only an admin can mark a template approved." };
    update.status = next;
    update.approved_at = next === "approved" ? new Date().toISOString() : null;
    update.rejection_reason = next === "rejected" ? (cleanText(patch.rejection_reason, LIMITS.reason) || "Not accepted by WhatsApp") : null;
  }
  if (Object.keys(update).length === 0) return { status: row.status };
  update.updated_at = new Date().toISOString();
  const { error } = await ctx.admin.from("whatsapp_templates").update(update).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) {
    if (error.code === "23505") throw { status: 409, message: "A template with that name and language already exists." };
    throw { status: 500, message: "Could not save the template" };
  }
  const changes = diffForLog("whatsapp_templates", row as unknown as Record<string, unknown>, { ...update, updated_at: undefined });
  if (changes.length) {
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "whatsapp_templates", objectId: id, objectLabel: row.ref ?? row.name,
      action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes,
    });
  }
  return { status: (update.status as TemplateStatus | undefined) ?? row.status };
}

/** A template that has been sent is archived, not deleted: the log of what went out keeps pointing at it. */
export async function deleteTemplate(ctx: ModuleCtx, id: string): Promise<"deleted" | "archived" | "missing" | "not_found"> {
  const current = await loadTemplate(ctx, id);
  if (current.missing) return "missing";
  if (!current.data) return "not_found";
  const { data } = await ctx.admin.from("whatsapp_messages").select("id").eq("tenant_id", ctx.tenantId).eq("template_id", id).limit(1);
  if (((data ?? []) as unknown[]).length > 0) {
    await ctx.admin.from("whatsapp_templates").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId);
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "whatsapp_templates", objectId: id, objectLabel: current.data.ref ?? current.data.name,
      action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "status", from: current.data.status, to: "archived" }],
    });
    return "archived";
  }
  const { error } = await ctx.admin.from("whatsapp_templates").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) throw { status: 500, message: "Could not delete the template" };
  await logChange(ctx.supabase, {
    tenantId: ctx.tenantId, objectType: "whatsapp_templates", objectId: id, objectLabel: current.data.ref ?? current.data.name,
    action: "delete", actorId: ctx.userId, actorEmail: ctx.email, changes: [],
  });
  return "deleted";
}

// ── the message log ──────────────────────────────────────────────────────────

export type MessageView = {
  id: string; direction: "out" | "in"; status: string; created_at: string; body: string; origin: string;
  contactName: string; templateName: string | null; error: string | null; redirected: boolean;
};

/** The latest messages, decrypted for a signed-in member of the same workspace. */
export async function recentMessages(ctx: ModuleCtx, limit = 25): Promise<{ rows: MessageView[]; missing: boolean }> {
  const { data, error } = await ctx.supabase.from("whatsapp_messages")
    .select("id, direction, status, created_at, body, origin, contact_id, template_id, error, redirected_to")
    .eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(limit);
  if (error) return { rows: [], missing: isSchemaPending(error) };
  const rows = (data ?? []) as { id: string; direction: "out" | "in"; status: string; created_at: string; body: string | null; origin: string; contact_id: string | null; template_id: string | null; error: string | null; redirected_to: string | null }[];
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((x): x is string => !!x))];
  const templateIds = [...new Set(rows.map((r) => r.template_id).filter((x): x is string => !!x))];
  const [contacts, templates] = await Promise.all([
    contactIds.length ? ctx.supabase.from("contacts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", contactIds) : { data: [] },
    templateIds.length ? ctx.supabase.from("whatsapp_templates").select("id, name").eq("tenant_id", ctx.tenantId).in("id", templateIds) : { data: [] },
  ]);
  const cName = new Map(((contacts.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const tName = new Map(((templates.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  return {
    missing: false,
    rows: rows.map((r) => ({
      id: r.id, direction: r.direction, status: r.status, created_at: r.created_at, body: decrypt(r.body) ?? "", origin: r.origin,
      contactName: (r.contact_id && cName.get(r.contact_id)) || "Unknown", templateName: (r.template_id && tName.get(r.template_id)) || null,
      error: r.error, redirected: !!r.redirected_to,
    })),
  };
}
