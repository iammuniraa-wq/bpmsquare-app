import "server-only";
import { isSchemaPending } from "@/lib/marketing/pending";
import { isUuid } from "@/lib/newsletter/requests";
import { PENDING_MESSAGE, createVersion, loadBundle, loadVersion, type NewsletterCtx } from "@/lib/newsletter/server";
import type { JourneyCtx } from "./access";

// A journey's send step picks a newsletter by NAME. The step still stores the kept version it will send (the
// runner, the consent gate and the language rule are unchanged); what changed is who keeps it: choosing the
// newsletter keeps a version of it as it is now (a new one only when it changed), so nobody visits the studio
// first. Every query carries the tenant; a foreign newsletter id matches nothing.

export type PickableNewsletter = { id: string; name: string; topic: string | null; languages: string[]; versionIds: string[] };

export async function listPickableNewsletters(ctx: JourneyCtx): Promise<{ newsletters: PickableNewsletter[]; pending: boolean }> {
  const nl = await ctx.admin.from("newsletters").select("id, name, topic, updated_at").eq("tenant_id", ctx.tenantId).eq("is_template", false).neq("status", "archived").order("updated_at", { ascending: false }).limit(100);
  if (nl.error) return { newsletters: [], pending: isSchemaPending(nl.error) };
  const rows = (nl.data ?? []) as { id: string; name: string; topic: string | null }[];
  if (rows.length === 0) return { newsletters: [], pending: false };
  const vs = await ctx.admin.from("newsletter_versions").select("id, newsletter_id, languages:snapshot->languages").eq("tenant_id", ctx.tenantId).in("newsletter_id", rows.map((r) => r.id)).order("created_at", { ascending: false }).limit(500);
  const byNewsletter = new Map<string, { ids: string[]; languages: string[] }>();
  for (const v of ((vs.error ? [] : vs.data) ?? []) as unknown as { id: string; newsletter_id: string; languages: { lang: string }[] | null }[]) {
    const e = byNewsletter.get(v.newsletter_id) ?? { ids: [], languages: (v.languages ?? []).map((l) => l.lang) };
    e.ids.push(v.id);
    byNewsletter.set(v.newsletter_id, e);
  }
  return {
    pending: false,
    newsletters: rows.map((r) => ({ id: r.id, name: r.name, topic: r.topic, languages: byNewsletter.get(r.id)?.languages ?? [], versionIds: byNewsletter.get(r.id)?.ids ?? [] })),
  };
}

export type StepNewsletter = { version_id: string; topic: string | null; languages: string[] };
export type PickFail = { ok: false; status: number; error: string };

/** Keeps a version of the picked newsletter and says what the step inherits from it. */
export async function resolveNewsletterForStep(jctx: JourneyCtx, nctx: NewsletterCtx, newsletterId: unknown): Promise<({ ok: true } & StepNewsletter) | PickFail> {
  if (!isUuid(newsletterId)) return { ok: false, status: 422, error: "Pick a newsletter." };
  const loaded = await loadBundle(nctx, newsletterId);
  if (loaded.missing) return { ok: false, status: 503, error: PENDING_MESSAGE };
  if (!loaded.data) return { ok: false, status: 404, error: "Newsletter not found" };
  const { newsletter } = loaded.data;
  if (newsletter.is_template) return { ok: false, status: 422, error: "A template is a starting point. Start a newsletter from it, then pick that." };
  if (newsletter.status === "archived") return { ok: false, status: 422, error: "This newsletter is archived." };
  const kept = await createVersion(nctx, loaded.data);
  if ("missing" in kept) return { ok: false, status: 503, error: PENDING_MESSAGE };
  const version = await loadVersion(nctx.admin, nctx.tenantId, kept.id);
  if (!version) return { ok: false, status: 500, error: "Could not keep a version of this newsletter." };
  const topicKeys = new Set(jctx.env.topics.map((t) => t.key));
  return { ok: true, version_id: kept.id, topic: version.snapshot.topic && topicKeys.has(version.snapshot.topic) ? version.snapshot.topic : null, languages: version.snapshot.languages.map((l) => l.lang) };
}
