"use client";

import type { NovaStreamItem } from "@/lib/nova/stream";
import type { NovaFlow } from "@/lib/nova/flows";

export type NovaNavData = { items: NovaStreamItem[]; flows: NovaFlow[] };

/**
 * Shared client-side loader for /api/nova/nav, fixing two things the
 * original one-off fetch in NovaSidebar had (owner-flagged 2026-08-23:
 * "Needs You Now / Flows take time to load"):
 *
 * 1. Cache-first paint. The rail could only start fetching after
 *    hydration, against a possibly-cold serverless function running ~8
 *    aggregate queries -- so every hard reload showed empty sections for
 *    a second or more. The last good payload is kept in sessionStorage
 *    and painted immediately on mount; the network refresh then replaces
 *    it. sessionStorage is per-tab AND per-origin -- tenant identity here
 *    is the hostname, so a different tenant is a different origin and can
 *    never read this cache; it also dies with the tab, so it can't grow
 *    stale for days. Still, entries older than TTL_MS are ignored, so a
 *    reopened background tab revalidates before showing anything.
 *
 * 2. In-flight dedupe. The rail AND the top-bar Spaces categories both
 *    need this payload (attention dots); a module-level promise means
 *    they share one request instead of firing two identical ones.
 *    (Client-side module state is per-browser-tab, per-user -- the
 *    multi-tenant guardrail against module-level caches targets shared
 *    SERVER processes, which this never runs in.)
 */

const KEY = "nova_nav_cache_v1";
const TTL_MS = 5 * 60 * 1000;

let inflight: Promise<NovaNavData | null> | null = null;

export function readNovaNavCache(): NovaNavData | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: NovaNavData };
    if (!parsed?.data || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > TTL_MS) return null;
    if (!Array.isArray(parsed.data.items) || !Array.isArray(parsed.data.flows)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function fetchNovaNav(): Promise<NovaNavData | null> {
  if (inflight) return inflight;
  inflight = fetch("/api/nova/nav")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { items?: NovaStreamItem[]; flows?: NovaFlow[] } | null) => {
      if (!data) return null;
      const out: NovaNavData = { items: data.items ?? [], flows: data.flows ?? [] };
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: out })); } catch { /* quota/private mode -- cache is optional */ }
      return out;
    })
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}
