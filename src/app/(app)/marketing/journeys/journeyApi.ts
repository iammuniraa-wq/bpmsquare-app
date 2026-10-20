import type { Activity } from "@/lib/marketing/journeys/activity";
import type { GoLiveCheck, Entrant } from "@/lib/marketing/journeys/preview";
import type { TraceLine } from "@/lib/marketing/journeys/simulate";
import type { JourneyDefinition } from "@/lib/marketing/journeys/types";

// The builder's calls to its own routes. Every call answers { ok, data } or { ok: false, error, status } and the
// screen decides what to say, in plain words.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; pending?: boolean; body?: Record<string, unknown> };

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof json.error === "string" ? json.error : "Something went wrong.", status: res.status, pending: json.pending_migration === true, body: json };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again.", status: 0 };
  }
}

const send = <T>(method: string, url: string, body: unknown) => call<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type PreviewData = {
  entry: { count: number; first: Entrant[]; lookback_days: number; at_least: boolean };
  checks: GoLiveCheck[];
  needs_confirm: boolean;
};

export type ActivityData = Activity & { task_list: { id: string; title: string; due_on: string | null; status: string; mine: boolean; unassigned: boolean }[] };

export const createJourney = (name: string, template: string) => send<{ id: string; ref: string | null }>("POST", "/api/journeys", { name, template });
export const saveJourney = (id: string, body: { name?: string; definition?: JourneyDefinition }) => send<{ journey: { id: string; version: number } }>("PATCH", `/api/journeys/${id}`, body);
export const removeJourney = (id: string) => call<{ result: "deleted" | "archived" }>(`/api/journeys/${id}`, { method: "DELETE" });
export const setStatus = (id: string, action: "turn_on" | "pause", confirm = false) => send<{ status: string; enrolled: number; needs_confirm?: boolean; checks?: GoLiveCheck[] }>("POST", `/api/journeys/${id}/status`, { action, confirm });
export const previewJourney = (id: string) => call<PreviewData>(`/api/journeys/${id}/preview`);
export const simulate = (id: string, contactId: string, definition: JourneyDefinition) =>
  send<{ person: { name: string; account: string }; lines: TraceLine[]; wouldSend: number }>("POST", `/api/journeys/${id}/simulate`, { contact_id: contactId, definition });
export const loadActivity = (id: string) => call<ActivityData>(`/api/journeys/${id}/activity`);
export const lookupVersions = () => call<{ versions: { id: string; label: string; languages: string[] }[] }>("/api/journeys/lookup?kind=versions");
export const lookupContacts = (q: string) => call<{ contacts: { id: string; name: string; account: string }[] }>(`/api/journeys/lookup?kind=contacts&q=${encodeURIComponent(q)}`);
export const completeTask = (id: string) => send<{ ok: true }>("PATCH", `/api/journeys/tasks/${id}`, { status: "done" });
