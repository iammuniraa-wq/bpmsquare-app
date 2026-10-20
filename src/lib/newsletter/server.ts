import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canCreateWorkcenter, canEditWorkcenter, canDeleteWorkcenter } from "@/lib/permissions";
import { insertWithMasterRef } from "@/lib/masterRef";
import { logChange, diffForLog } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { topicsOf } from "@/lib/marketing/config";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { resolveBrandKit, type ResolvedBrandKit } from "./brandKit";
import { renderNewsletter } from "./render";
import { languageStatus, pendingBlocks, sanitizeLanguageRow, sanitizeNewsletterBlocks } from "./sanitize";
import { isUuid, type ListParams, type SavePayload } from "./requests";
import {
  SOURCE_LANGUAGE, TEXT_FIELDS, type LanguageRow, type NewsletterBlock, type NewsletterCategory, type NewsletterStatus,
} from "./types";

// Newsletter Studio server core (0141-0143, docs/newsletter-studio-architecture.md).
//
// How tenant isolation holds here, concretely (MULTI_TENANT_GUARDRAILS.md):
//   - every route starts with newsletterAccess() -> requireTenantUser(); the
//     tenantId used afterwards is only the one that returns, never a body field;
//   - the studio is reachable only when the tenant owns BOTH `marketing` and the
//     platform-admin flag `newsletter_studio`, otherwise every route answers 404;
//   - reads and plain writes use the SESSION client: the RLS policies of 0141 are
//     the real backstop, and every query also chains .eq("tenant_id", tenantId);
//   - versions are select-only for members, so they are written with the
//     service-role client. That client BYPASSES RLS, so every query on it chains
//     .eq("tenant_id", tenantId) and runs only after the newsletter was loaded
//     through the session client for this tenant;
//   - the foreign ids a body can carry (a product on a product card, a template
//     it was copied from) are re-verified against the tenant before they are kept.

export const PENDING_MESSAGE = "The Newsletter Studio is waiting for a database update (migration 0141 has not been applied to this database).";

export const isMissingRelation = isSchemaPending;

export type NewsletterAction = "view" | "create" | "edit" | "delete";

export type NewsletterCtx = {
  /** The session client: RLS applies. */
  supabase: SupabaseClient;
  /** The service-role client: bypasses RLS. Versions and events only, after the checks. */
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
  isDemo: boolean;
  config: TenantConfig;
  tenantName: string;
  logoUrl: string | null;
  kit: ResolvedBrandKit;
  /** What the caller's business role lets them do with the Newsletters workcenter (the action asked for is already enforced). */
  can: { view: boolean; create: boolean; edit: boolean; delete: boolean };
};

export const assetBaseUrl = (): string => `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "")}/storage/v1/object/public/company-assets`;

/** The tenant owns the Marketing module AND the newsletter_studio flag. Anything else is "not found". */
export function studioEnabled(features: Partial<TenantFeatures> | null | undefined): boolean {
  return features?.marketing === true && features?.newsletter_studio === true;
}

export async function newsletterAccess(action: NewsletterAction): Promise<NewsletterCtx> {
  const a = await requireTenantUser();
  const admin = createAdminSupabase();
  const [user, tenant] = await Promise.all([
    getAuthUser(),
    admin.from("tenants").select("name, is_demo, config, features, logo_url").eq("id", a.tenantId).maybeSingle(),
  ]);
  if (!studioEnabled(tenant.data?.features as Partial<TenantFeatures> | undefined)) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  const can = {
    view: canViewWorkcenter(perms, "marketing_newsletters"), create: canCreateWorkcenter(perms, "marketing_newsletters"),
    edit: canEditWorkcenter(perms, "marketing_newsletters"), delete: canDeleteWorkcenter(perms, "marketing_newsletters"),
  };
  if (!can[action]) throw { status: 403, message: "Forbidden" };
  const config = (tenant.data?.config ?? {}) as TenantConfig;
  const tenantName = (tenant.data?.name as string | undefined) ?? "";
  const logoUrl = (tenant.data?.logo_url as string | null | undefined) ?? null;
  return {
    ...a, admin, email: user?.email ?? null, isDemo: tenant.data?.is_demo === true, config, tenantName, logoUrl,
    kit: resolveBrandKit(config.brand_kit, { name: tenantName, logo_url: logoUrl }), can,
  };
}

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string; code?: string };
  if (typeof err.status !== "number") console.error("newsletter studio route failed:", e);
  return Response.json({
    error: typeof err.status === "number" ? (err.message ?? "Unexpected error") : "Unexpected error",
    ...(typeof err.status === "number" && typeof err.code === "string" ? { code: err.code } : {}),
  }, { status: err.status ?? 500 });
}

export const pendingResponse = (): Response => Response.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });

// ── Types ───────────────────────────────────────────────────────────────────

export type NewsletterRow = {
  id: string;
  ref: string | null;
  name: string;
  is_template: boolean;
  category: NewsletterCategory;
  status: NewsletterStatus;
  source_language: string;
  topic: string | null;
  blocks: NewsletterBlock[];
  brand_kit: unknown;
  built_in_origin: string | null;
  template_origin_id: string | null;
  custom_data: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VersionSummary = { id: string; version: number; created_at: string };

export type NewsletterBundle = { newsletter: NewsletterRow; languages: LanguageRow[]; versions: VersionSummary[] };

const NEWSLETTER_COLUMNS = "id, ref, name, is_template, category, status, source_language, topic, blocks, brand_kit, built_in_origin, template_origin_id, custom_data, created_by, created_at, updated_at";
const LANGUAGE_COLUMNS = "id, lang, dir, subject, preheader, texts, review, status, translated_by";

export type Loaded<T> = { data: T | null; missing: boolean };

const toRow = (r: Record<string, unknown>): NewsletterRow => ({
  ...(r as unknown as NewsletterRow),
  blocks: Array.isArray(r.blocks) ? (r.blocks as NewsletterBlock[]) : [],
});

const toLanguage = (r: Record<string, unknown>): LanguageRow => ({
  ...(r as unknown as LanguageRow),
  texts: (r.texts as LanguageRow["texts"]) ?? {},
  review: (r.review as LanguageRow["review"]) ?? {},
});

/** Opens a newsletter by id: tenant-scoped, RLS-backed. A missing one and another tenant's one answer the same. */
export async function loadBundle(ctx: NewsletterCtx, id: string): Promise<Loaded<NewsletterBundle>> {
  if (!isUuid(id)) return { data: null, missing: false };
  const { data, error } = await ctx.supabase.from("newsletters").select(NEWSLETTER_COLUMNS).eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { data: null, missing: isMissingRelation(error) };
  if (!data) return { data: null, missing: false };
  const [langs, vers] = await Promise.all([
    ctx.supabase.from("newsletter_languages").select(LANGUAGE_COLUMNS).eq("newsletter_id", id).eq("tenant_id", ctx.tenantId).order("created_at"),
    ctx.supabase.from("newsletter_versions").select("id, version, created_at").eq("newsletter_id", id).eq("tenant_id", ctx.tenantId).order("version", { ascending: false }),
  ]);
  if (langs.error && isMissingRelation(langs.error)) return { data: null, missing: true };
  const languages = ((langs.data ?? []) as Record<string, unknown>[]).map(toLanguage);
  // English first, then the order they were added.
  languages.sort((a, b) => (a.lang === SOURCE_LANGUAGE ? -1 : b.lang === SOURCE_LANGUAGE ? 1 : 0));
  return { data: { newsletter: toRow(data as Record<string, unknown>), languages, versions: (vers.data ?? []) as VersionSummary[] }, missing: false };
}

export async function ownedBundle(ctx: NewsletterCtx, id: string): Promise<NewsletterBundle> {
  const r = await loadBundle(ctx, id);
  if (r.missing) throw { status: 503, message: PENDING_MESSAGE };
  if (!r.data) throw { status: 404, message: "Newsletter not found" };
  return r.data;
}

export type ListedNewsletter = Pick<NewsletterRow, "id" | "ref" | "name" | "category" | "status" | "is_template" | "updated_at"> & { languages: string[] };

export async function listNewsletters(ctx: NewsletterCtx, p: ListParams): Promise<{ rows: ListedNewsletter[]; total: number; missing: boolean }> {
  let q = ctx.supabase
    .from("newsletters")
    .select("id, ref, name, category, status, is_template, updated_at", { count: "exact" })
    .eq("tenant_id", ctx.tenantId)
    .eq("is_template", p.template);
  if (p.status) q = q.eq("status", p.status);
  else q = q.neq("status", "archived");
  if (p.category) q = q.eq("category", p.category);
  if (p.q) q = q.or(`name.ilike.%${p.q}%,ref.ilike.%${p.q}%`);
  const from = (p.page - 1) * p.page_size;
  const { data, error, count } = await q.order("updated_at", { ascending: false }).order("id").range(from, from + p.page_size - 1);
  if (error) {
    if (isMissingRelation(error)) return { rows: [], total: 0, missing: true };
    throw { status: 500, message: "Could not load newsletters" };
  }
  const rows = (data ?? []) as Omit<ListedNewsletter, "languages">[];
  const langs = rows.length
    ? await ctx.supabase.from("newsletter_languages").select("newsletter_id, lang").eq("tenant_id", ctx.tenantId).in("newsletter_id", rows.map((r) => r.id))
    : { data: [] as { newsletter_id: string; lang: string }[] };
  const byId = new Map<string, string[]>();
  for (const l of (langs.data ?? []) as { newsletter_id: string; lang: string }[]) byId.set(l.newsletter_id, [...(byId.get(l.newsletter_id) ?? []), l.lang]);
  return { rows: rows.map((r) => ({ ...r, languages: byId.get(r.id) ?? [] })), total: count ?? rows.length, missing: false };
}

// ── Foreign ids ─────────────────────────────────────────────────────────────

/** Keeps a product card's product_id only when it resolves to a product of THIS tenant. */
export async function verifyProducts(ctx: NewsletterCtx, blocks: NewsletterBlock[]): Promise<{ blocks: NewsletterBlock[]; dropped: number }> {
  const ids = [...new Set(blocks.map((b) => b.settings.product_id).filter((v): v is string => typeof v === "string"))];
  if (ids.length === 0) return { blocks, dropped: 0 };
  const { data, error } = await ctx.supabase.from("products").select("id").eq("tenant_id", ctx.tenantId).in("id", ids);
  const ok = new Set(error ? [] : ((data ?? []) as { id: string }[]).map((r) => r.id));
  let dropped = 0;
  const out = blocks.map((b) => {
    const pid = b.settings.product_id;
    if (typeof pid === "string" && !ok.has(pid)) {
      dropped++;
      const settings = { ...b.settings };
      delete settings.product_id;
      return { ...b, settings };
    }
    return b;
  });
  return { blocks: out, dropped };
}

async function verifyTemplateOrigin(ctx: NewsletterCtx, id: string | null | undefined): Promise<string | null> {
  if (!isUuid(id)) return null;
  const { data } = await ctx.supabase.from("newsletters").select("id").eq("id", id).eq("tenant_id", ctx.tenantId).eq("is_template", true).maybeSingle();
  return data ? (data as { id: string }).id : null;
}

// ── Saving ──────────────────────────────────────────────────────────────────

const sameText = (a: string | undefined, b: string | undefined): boolean => (a ?? "") === (b ?? "");

/**
 * A block whose English words changed since the last save flags the same block
 * "translated" again in every other language (doc section 5): it is never
 * silently re-translated, and the language stops being sendable until a person
 * has looked at it again.
 */
export function flagChangedSource(prev: LanguageRow | undefined, next: LanguageRow, others: LanguageRow[], blocks: readonly NewsletterBlock[]): LanguageRow[] {
  if (!prev) return others;
  return others.map((o) => {
    const review = { ...o.review };
    for (const b of blocks) {
      const before = prev.texts[b.id] ?? {};
      const after = next.texts[b.id] ?? {};
      if (TEXT_FIELDS[b.type].some((f) => !sameText(before[f], after[f])) && (review[b.id] ?? "written") !== "translated" && (o.texts[b.id] && Object.keys(o.texts[b.id]).length)) {
        review[b.id] = "translated";
      }
    }
    return { ...o, review, status: languageStatus({ review }, blocks) };
  });
}

type SaveResult = { id: string; ref: string | null; warnings: string[]; readyLanguages: string[] };

/**
 * Creates (id = null) or updates a newsletter from a full payload. Everything in
 * the payload passes through the sanitisers; nothing is stored as written.
 */
export async function saveNewsletter(ctx: NewsletterCtx, id: string | null, payload: SavePayload): Promise<SaveResult | { missing: true }> {
  const existing = id ? await ownedBundle(ctx, id) : null;

  const rawBlocks = payload.blocks !== undefined ? payload.blocks : existing?.newsletter.blocks;
  const gate = sanitizeNewsletterBlocks(rawBlocks, ctx.tenantId);
  const verified = await verifyProducts(ctx, gate.blocks);
  const blocks = verified.blocks;
  const warnings = [...gate.notes, ...(verified.dropped ? [`${verified.dropped} product${verified.dropped > 1 ? "s" : ""} are not in your catalogue and were unlinked.`] : [])];

  const incoming: LanguageRow[] = [];
  const rawLangs = payload.languages !== undefined ? (payload.languages as unknown[]) : existing?.languages;
  for (const raw of Array.isArray(rawLangs) ? rawLangs : []) {
    const row = sanitizeLanguageRow(raw, blocks);
    if (row && !incoming.some((r) => r.lang === row.lang)) incoming.push(row);
  }
  const source = incoming.find((l) => l.lang === SOURCE_LANGUAGE);
  if (!source) throw { status: 422, message: "A newsletter is written in English first; the English words are missing." };

  // Re-flag other languages for blocks whose English words changed.
  const prevSource = existing?.languages.find((l) => l.lang === SOURCE_LANGUAGE);
  const others = flagChangedSource(prevSource, source, incoming.filter((l) => l.lang !== SOURCE_LANGUAGE), blocks);
  const languages = [source, ...others];

  const topic = payload.topic !== undefined ? payload.topic : existing?.newsletter.topic ?? null;
  if (topic && !topicsOf(ctx.config).some((t) => t.key === topic)) throw { status: 422, message: "That topic is not one of your workspace topics." };

  // Ready means: every language has a subject and has been reviewed. Archiving is a person's choice, never overwritten.
  const computed: NewsletterStatus = languages.every((l) => l.status === "ready" && l.subject.trim()) ? "ready" : "draft";
  const status: NewsletterStatus = payload.status ?? (existing?.newsletter.status === "archived" ? "archived" : computed);

  const header = {
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.category !== undefined ? { category: payload.category } : {}),
    status,
    ...(payload.custom_data !== undefined ? { custom_data: payload.custom_data } : {}),
    topic,
    blocks,
    brand_kit: ctx.kit,
    updated_at: new Date().toISOString(),
  };

  let newsletterId = id;
  let ref: string | null = existing?.newsletter.ref ?? null;
  if (!id) {
    const origin = await verifyTemplateOrigin(ctx, payload.template_origin_id);
    const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(ctx.supabase, "newsletters", ctx.tenantId, {
      tenant_id: ctx.tenantId,
      name: payload.name ?? "Untitled newsletter",
      category: payload.category ?? "Newsletter",
      is_template: payload.is_template === true,
      status,
      source_language: SOURCE_LANGUAGE,
      topic, blocks, brand_kit: ctx.kit,
      built_in_origin: payload.built_in_origin ?? null,
      template_origin_id: origin,
      custom_data: payload.custom_data ?? null,
      created_by: ctx.userId,
    }, "id, ref");
    if (error || !data) {
      if (error && isMissingRelation(error)) return { missing: true };
      throw { status: 500, message: "Could not save the newsletter" };
    }
    newsletterId = data.id;
    ref = data.ref;
  } else {
    const { error } = await ctx.supabase.from("newsletters").update(header).eq("id", id).eq("tenant_id", ctx.tenantId);
    if (error) throw { status: 500, message: "Could not save the newsletter" };
  }
  if (!newsletterId) throw { status: 500, message: "Could not save the newsletter" };

  // Language rows: upsert by (newsletter, lang); a language no longer in the payload is removed.
  const before = new Map((existing?.languages ?? []).map((l) => [l.lang, l]));
  const readyLanguages: string[] = [];
  for (const l of languages) {
    const was = before.get(l.lang);
    const becameReady = l.lang !== SOURCE_LANGUAGE && l.status === "ready" && was?.status !== "ready";
    if (becameReady) readyLanguages.push(l.lang);
    const { error } = await ctx.supabase.from("newsletter_languages").upsert({
      tenant_id: ctx.tenantId, newsletter_id: newsletterId, lang: l.lang, dir: l.dir, subject: l.subject, preheader: l.preheader,
      texts: l.texts, review: l.review, status: l.status, translated_by: l.translated_by ?? (l.lang === SOURCE_LANGUAGE ? "person" : null),
      ...(becameReady ? { reviewed_by: ctx.userId, reviewed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: "newsletter_id,lang" });
    if (error) throw { status: 500, message: "Could not save the words" };
  }
  const keep = new Set(languages.map((l) => l.lang));
  const drop = [...before.keys()].filter((k) => !keep.has(k));
  if (drop.length) await ctx.supabase.from("newsletter_languages").delete().eq("newsletter_id", newsletterId).eq("tenant_id", ctx.tenantId).in("lang", drop);

  const isTemplate = existing?.newsletter.is_template ?? payload.is_template === true;
  const langsPresent = languages.map((l) => l.lang);
  await Promise.all([
    emitEvent(ctx.tenantId, {
      name: existing ? EVENTS.NEWSLETTER_UPDATED : EVENTS.NEWSLETTER_CREATED, object_type: "newsletter", object_id: newsletterId, actor_id: ctx.userId,
      newsletter_id: newsletterId, payload: { is_template: isTemplate, languages: langsPresent },
    }),
    ...readyLanguages.map((lang) => emitEvent(ctx.tenantId, {
      name: EVENTS.NEWSLETTER_LANGUAGE_READY, object_type: "newsletter", object_id: newsletterId, actor_id: ctx.userId,
      newsletter_id: newsletterId, lang, key: `${newsletterId}:${lang}:ready:${new Date().toISOString().slice(0, 16)}`,
      payload: { lang, reviewed_by: ctx.userId },
    })),
  ]);

  if (!existing) {
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "newsletters", objectId: newsletterId, objectLabel: ref ?? payload.name ?? null,
      action: "create", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "name", from: null, to: payload.name ?? null }],
    });
  } else {
    const changes = diffForLog("newsletters", existing.newsletter as unknown as Record<string, unknown>, {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.category !== undefined ? { category: payload.category } : {}),
      status,
      topic,
    });
    if (changes.length || JSON.stringify(existing.newsletter.blocks) !== JSON.stringify(blocks)) {
      await logChange(ctx.supabase, {
        tenantId: ctx.tenantId, objectType: "newsletters", objectId: newsletterId, objectLabel: existing.newsletter.ref ?? existing.newsletter.name,
        action: "update", actorId: ctx.userId, actorEmail: ctx.email,
        changes: [...changes, ...(JSON.stringify(existing.newsletter.blocks) !== JSON.stringify(blocks) ? [{ field: "design", from: null, to: "blocks changed" }] : [])],
      });
    }
    if (payload.status === "archived" && existing.newsletter.status !== "archived") {
      await emitEvent(ctx.tenantId, { name: EVENTS.NEWSLETTER_ARCHIVED, object_type: "newsletter", object_id: newsletterId, actor_id: ctx.userId, newsletter_id: newsletterId, payload: { is_template: isTemplate } });
    }
  }

  return { id: newsletterId, ref, warnings, readyLanguages };
}

// ── Versions ────────────────────────────────────────────────────────────────

export type VersionSnapshot = {
  name: string;
  blocks: NewsletterBlock[];
  languages: { lang: string; dir: "ltr" | "rtl"; subject: string; preheader: string; texts: LanguageRow["texts"]; review: LanguageRow["review"]; status: "draft" | "ready" }[];
  kit: ResolvedBrandKit;
  topic: string | null;
  open_pixel: boolean;
};

export type StoredVersion = {
  id: string;
  newsletter_id: string;
  version: number;
  snapshot: VersionSnapshot;
  html: Record<string, string>;
  text: Record<string, string>;
  links: { url: string; label: string; block_id: string; block_type: string; topic_id?: string; product_id?: string }[];
};

/**
 * Takes an immutable version of a newsletter ("Use in a campaign"). If nothing
 * changed since the latest version, that version is returned instead of a new
 * number. The HTML is rendered once per language here, with the merge tokens
 * still in place; the send fills them per recipient.
 */
export async function createVersion(ctx: NewsletterCtx, bundle: NewsletterBundle): Promise<{ id: string; version: number; reused: boolean } | { missing: true }> {
  const { newsletter, languages } = bundle;
  const openPixel = ctx.config.marketing?.track_opens === true;
  const snapshot: VersionSnapshot = {
    name: newsletter.name, blocks: newsletter.blocks, topic: newsletter.topic, kit: ctx.kit, open_pixel: openPixel,
    languages: languages.map((l) => ({ lang: l.lang, dir: l.dir, subject: l.subject, preheader: l.preheader, texts: l.texts, review: l.review, status: languageStatus(l, newsletter.blocks) })),
  };

  const latest = await ctx.supabase.from("newsletter_versions").select("id, version, snapshot").eq("newsletter_id", newsletter.id).eq("tenant_id", ctx.tenantId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (latest.error && isMissingRelation(latest.error)) return { missing: true };
  const last = latest.data as { id: string; version: number; snapshot: VersionSnapshot } | null;
  if (last && JSON.stringify(last.snapshot) === JSON.stringify(snapshot)) return { id: last.id, version: last.version, reused: true };

  const html: Record<string, string> = {};
  const text: Record<string, string> = {};
  let links: StoredVersion["links"] = [];
  for (const l of languages) {
    const out = renderNewsletter({
      blocks: newsletter.blocks, language: l, kit: ctx.kit, tenantId: ctx.tenantId, assetBase: assetBaseUrl(), target: "version", openPixel,
    });
    html[l.lang] = out.html;
    text[l.lang] = out.text;
    if (l.lang === SOURCE_LANGUAGE || links.length === 0) links = out.links;
  }

  const version = (last?.version ?? 0) + 1;
  const { data, error } = await ctx.admin.from("newsletter_versions").insert({
    tenant_id: ctx.tenantId, newsletter_id: newsletter.id, version, snapshot, html, text, links, created_by: ctx.userId,
  }).select("id").single();
  if (error || !data) {
    if (error && isMissingRelation(error)) return { missing: true };
    throw { status: 500, message: "Could not keep a version" };
  }
  await emitEvent(ctx.tenantId, {
    name: EVENTS.NEWSLETTER_VERSION_CREATED, object_type: "newsletter", object_id: newsletter.id, actor_id: ctx.userId,
    newsletter_id: newsletter.id, newsletter_version_id: data.id, key: `${data.id}:created`, payload: { version },
  });
  return { id: (data as { id: string }).id, version, reused: false };
}

/** A version the tenant owns, with its stored HTML. Null for anything else. */
export async function loadVersion(client: SupabaseClient, tenantId: string, versionId: string): Promise<StoredVersion | null> {
  if (!isUuid(versionId)) return null;
  const { data, error } = await client
    .from("newsletter_versions").select("id, newsletter_id, version, snapshot, html, text, links")
    .eq("id", versionId).eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  return data as unknown as StoredVersion;
}

/** Writes one language row (used when a language is added). Returns false when the table is missing. */
export async function upsertLanguage(ctx: NewsletterCtx, newsletterId: string, l: LanguageRow): Promise<boolean> {
  const { error } = await ctx.supabase.from("newsletter_languages").upsert({
    tenant_id: ctx.tenantId, newsletter_id: newsletterId, lang: l.lang, dir: l.dir, subject: l.subject, preheader: l.preheader,
    texts: l.texts, review: l.review, status: l.status, translated_by: l.translated_by ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "newsletter_id,lang" });
  if (error) {
    if (isMissingRelation(error)) return false;
    throw { status: 500, message: "Could not save the language" };
  }
  await ctx.supabase.from("newsletters").update({ updated_at: new Date().toISOString() }).eq("id", newsletterId).eq("tenant_id", ctx.tenantId);
  return true;
}

/** Languages of a version a campaign may include: every block reviewed. */
export const sendableLanguages = (v: Pick<StoredVersion, "snapshot">): string[] =>
  v.snapshot.languages.filter((l) => l.status === "ready" || pendingBlocks(l, v.snapshot.blocks).length === 0).map((l) => l.lang);
