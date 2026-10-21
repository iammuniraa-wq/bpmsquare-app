"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isLiveRun, type D365Run } from "@/lib/connectors/d365/runSummary";

const POLL_MS = 3000;

/**
 * The run history and per-entity linked counts, kept fresh by itself.
 * `refresh()` re-reads at once and once more shortly after (a write that
 * finished a moment ago can lag the first read). While any run is live, or
 * `active` says an action is in flight, it re-reads every few seconds, so a
 * run shows up as it starts and settles when it ends -- no manual reload.
 */
export function useD365Runs({ url = "/api/connectors/dynamics365/runs", active = false }: { url?: string; active?: boolean } = {}) {
  const [runs, setRuns] = useState<D365Run[]>([]);
  const [linked, setLinked] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);

  const read = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (mine !== seq.current || !res.ok) return;
      setRuns((j.runs ?? []) as D365Run[]);
      setLinked((j.linked ?? {}) as Record<string, number>);
    } catch {
      // keep what is on screen; the next read tries again
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [url]);

  const refresh = useCallback(async () => {
    await read();
    if (later.current) clearTimeout(later.current);
    later.current = setTimeout(() => { void read(); }, 1500);
  }, [read]);

  useEffect(() => {
    void read();
    return () => { if (later.current) clearTimeout(later.current); };
  }, [read]);

  const live = runs.some((r) => isLiveRun(r, Date.now()));
  useEffect(() => {
    if (!live && !active) return;
    const t = setInterval(() => { void read(); }, POLL_MS);
    return () => clearInterval(t);
  }, [live, active, read]);

  return { runs, linked, loading, refresh };
}
