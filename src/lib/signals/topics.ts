import "server-only";
import { diffForLog, logChange } from "@/lib/changeLog";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { SignalsCtx } from "./access";
import type { SignalTopic } from "./types";

// Signal topics: minimal CRUD. Written on the service-role client (the table is
// select-only for members), so every query chains the tenant, and only an admin
// reaches these functions (signalsAccess("admin") in the routes).

export type TopicInput = { name: string; keywords: string[]; enabled: boolean };

export function parseTopic(body: unknown, partial: boolean): { ok: true; value: Partial<TopicInput> } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the topic as JSON." };
  const b = body as Record<string, unknown>;
  const out: Partial<TopicInput> = {};
  if (b.name !== undefined || !partial) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (name.length < 1 || name.length > 80) return { ok: false, error: "Give the topic a name of 1 to 80 characters." };
    out.name = name;
  }
  if (b.keywords !== undefined) {
    if (!Array.isArray(b.keywords)) return { ok: false, error: "Keywords must be a list." };
    out.keywords = [...new Set(b.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
  } else if (!partial) out.keywords = [];
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return { ok: false, error: "Enabled must be true or false." };
    out.enabled = b.enabled;
  } else if (!partial) out.enabled = true;
  return { ok: true, value: out };
}

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; pending?: boolean };

export async function createTopic(ctx: SignalsCtx, input: TopicInput): Promise<Result<SignalTopic>> {
  const { data, error } = await ctx.admin.from("signal_topics")
    .insert({ tenant_id: ctx.tenantId, name: input.name, keywords: input.keywords, enabled: input.enabled }).select("*").single();
  if (error) {
    if (isSchemaPending(error)) return { ok: false, status: 503, error: "Topics are waiting for a database update.", pending: true };
    if (error.code === "23505") return { ok: false, status: 409, error: "A topic with that name already exists." };
    return { ok: false, status: 500, error: "Could not save the topic." };
  }
  const row = data as SignalTopic;
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "signal_topics", objectId: row.id, objectLabel: row.name, action: "create", actorId: ctx.userId, actorEmail: ctx.email });
  return { ok: true, value: row };
}

export async function updateTopic(ctx: SignalsCtx, id: string, patch: Partial<TopicInput>): Promise<Result<SignalTopic>> {
  const { data: before } = await ctx.admin.from("signal_topics").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!before) return { ok: false, status: 404, error: "Not found" };
  const { data, error } = await ctx.admin.from("signal_topics")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId).select("*").single();
  if (error) return { ok: false, status: error.code === "23505" ? 409 : 500, error: error.code === "23505" ? "A topic with that name already exists." : "Could not save the topic." };
  const row = data as SignalTopic;
  await logChange(ctx.supabase, {
    tenantId: ctx.tenantId, objectType: "signal_topics", objectId: id, objectLabel: row.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email,
    changes: diffForLog("signal_topics", before as Record<string, unknown>, patch as Record<string, unknown>),
  });
  return { ok: true, value: row };
}

export async function deleteTopic(ctx: SignalsCtx, id: string): Promise<Result<true>> {
  const { data: before } = await ctx.admin.from("signal_topics").select("id, name").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!before) return { ok: false, status: 404, error: "Not found" };
  const { error } = await ctx.admin.from("signal_topics").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, status: 500, error: "Could not delete the topic." };
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "signal_topics", objectId: id, objectLabel: (before as { name: string }).name, action: "delete", actorId: ctx.userId, actorEmail: ctx.email });
  return { ok: true, value: true };
}
