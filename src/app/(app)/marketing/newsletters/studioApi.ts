import type { Check } from "@/lib/newsletter/checks";
import type { LanguageRow, NewsletterBlock } from "@/lib/newsletter/types";

// The studio's calls to its own routes. Every call answers { ok, data } or
// { ok:false, error, code } -- the screen decides what to say, in plain words.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; status: number; pending?: boolean };

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (json as { error?: string }).error ?? "Something went wrong.", code: (json as { code?: string }).code, status: res.status, pending: (json as { pending_migration?: boolean }).pending_migration };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again.", status: 0 };
  }
}

const post = <T>(url: string, body: unknown) => call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type SaveBody = {
  name: string; category: string; topic: string | null; blocks: NewsletterBlock[]; languages: LanguageRow[];
  template_origin_id?: string | null; built_in_origin?: string | null; status?: "draft" | "ready" | "archived";
};

export const createNewsletter = (b: SaveBody) => post<{ id: string; ref: string | null; warnings: string[] }>("/api/newsletters", b);
export const saveNewsletter = (id: string, b: SaveBody) => call<{ id: string; ref: string | null; warnings: string[] }>(`/api/newsletters/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
export const saveAsTemplate = (id: string, name: string, category: string) => post<{ id: string }>(`/api/newsletters/${id}/template`, { name, category });
export type SendAudience = { group_id?: string | null; account_types?: string[]; manual_emails?: string[] };
export type SendCheck = {
  total: number; contactable: number; byLanguage: Record<string, number>; languages: string[]; topic: string | null;
  groups: { id: string; label: string; count: number; fix: string }[];
};
export type SendResult = { sent: number; failed: number; skipped: number; by_language: Record<string, number>; campaign_id: string };
export const checkSend = (id: string, audience: SendAudience) => post<SendCheck>(`/api/newsletters/${id}/send`, { audience, check: true });
export const sendNewsletter = (id: string, audience: SendAudience) => post<SendResult>(`/api/newsletters/${id}/send`, { audience });
export const addLanguage = (id: string, lang: string, mode: "ai" | "empty") => post<{ language: LanguageRow; kept: string[] }>(`/api/newsletters/${id}/translate`, { lang, mode });
export const draftWithAi = (b: { brief: string; use_products: boolean; use_campaigns: boolean; topic: string | null }) =>
  post<{ subject: string; preheader: string; blocks: NewsletterBlock[]; texts: LanguageRow["texts"]; understood: string[]; assumed: string[]; warnings: string[] }>("/api/newsletters/ai/draft", b);
export const rewriteWithAi = (b: { text: string; tone: "shorter" | "warmer" | "formal"; lang: string; field: string }) =>
  post<{ text: string | null; kept?: boolean; message?: string }>("/api/newsletters/ai/rewrite", b);
export const loadTemplate = (id: string) => call<{ newsletter: { name: string; category: string; topic: string | null; blocks: NewsletterBlock[] }; languages: LanguageRow[] }>(`/api/newsletters/${id}`);
export const deleteNewsletter = (id: string) => call<{ ok: true }>(`/api/newsletters/${id}`, { method: "DELETE" });

export type PreviewData = {
  html: string; text: string; links: unknown[]; checks: Check[];
  languages: { lang: string; status: "draft" | "ready"; pending: string[] }[];
};
export const previewNewsletter = (blocks: NewsletterBlock[], languages: LanguageRow[], lang: string) => post<PreviewData>("/api/newsletters/preview", { blocks, languages, lang });

export async function uploadImage(file: File): Promise<ApiResult<{ path: string; url: string; bytes: number }>> {
  const fd = new FormData();
  fd.append("file", file);
  return call<{ path: string; url: string; bytes: number }>("/api/newsletters/images", { method: "POST", body: fd });
}
