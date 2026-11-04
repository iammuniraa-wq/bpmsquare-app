"use client";

import { useEffect, useRef, useState } from "react";
import type { AudiencePreview } from "./AudienceCount";

export type AudienceRule = {
  account_types: string[]; include_account_ids: string[]; exclude_account_ids: string[]; manual_emails: string[];
  filters: unknown[]; match: "all" | "any"; topic?: string | null;
};

/** The send's own count for a targeting rule, refreshed shortly after the rule changes. A late answer to an
 * older rule is dropped, so the number on screen always belongs to what is selected. */
export function useAudiencePreview(rule: AudienceRule, enabled = true): { preview: AudiencePreview | null; checking: boolean; error: string | null; refresh: () => void } {
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const ticket = useRef(0);
  const key = JSON.stringify(rule);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++ticket.current;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/marketing/recipients-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: key });
        const json = await res.json();
        if (mine !== ticket.current) return;
        if (!res.ok) { setError(json.error || "Could not count the audience"); setPreview(null); }
        else { setError(null); setPreview(json as AudiencePreview); }
      } catch {
        if (mine === ticket.current) { setError("Could not count the audience"); setPreview(null); }
      } finally {
        if (mine === ticket.current) setChecking(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [key, enabled, tick]);

  return { preview, checking, error, refresh: () => setTick((t) => t + 1) };
}
