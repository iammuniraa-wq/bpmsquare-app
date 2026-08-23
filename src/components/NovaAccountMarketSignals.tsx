"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MarketIntelResult } from "@/lib/nova/marketIntel";
import { readMarketIntelCache, fetchMarketIntel } from "@/lib/nova/marketIntelClient";

/**
 * Market Signals -- real, live web search about the account the rep is
 * currently looking at. Lives in the rail (owner request 2026-08-25: moved
 * out of the account page body, "if nothing is there it's blank anyway"),
 * driven by NovaAccountContextBeacon's window event rather than props,
 * since the rail (Shell.tsx) and the account page are siblings, not
 * parent/child. Renders nothing at all when no account is in view.
 *
 * Deliberately NOT auto-fetched: a real web-search-enabled Claude call is
 * slow and billed, so it only runs on an explicit click, and the result is
 * cached per tab for 6h (marketIntelClient.ts) so revisiting the account
 * doesn't re-trigger it.
 */
const TONE_COLOR: Record<"positive" | "neutral" | "risk", string> = {
  positive: "var(--nova-teal-soft)",
  neutral: "var(--nova-ink-dim)",
  risk: "var(--nova-orange-soft)",
};
const TONE_DOT: Record<"positive" | "neutral" | "risk", string> = {
  positive: "var(--nova-teal-soft)",
  neutral: "var(--nova-ink-faint)",
  risk: "var(--nova-orange-soft)",
};

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export default function NovaAccountMarketSignals() {
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const [data, setData] = useState<MarketIntelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onContext(e: Event) {
      const detail = (e as CustomEvent<{ id: string; name: string } | null>).detail;
      setAccount(detail);
      setError(null);
      setLoading(false);
      setData(detail ? readMarketIntelCache(detail.id) : null);
    }
    window.addEventListener("nova:account-context", onContext);
    return () => window.removeEventListener("nova:account-context", onContext);
  }, []);

  if (!account) return null;

  function load() {
    if (!account) return;
    setLoading(true);
    setError(null);
    fetchMarketIntel(account.id, account.name)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--nova-line-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", flex: 1 }}>Market signals</span>
        {data && !loading && (
          <button type="button" onClick={load} title="Refresh" style={{ fontSize: 9.5, color: "var(--nova-ink-faint)", background: "none", border: "none", cursor: "pointer" }}>
            {timeAgo(data.fetchedAt)} · ↻
          </button>
        )}
      </div>

      {!data && !loading && !error && (
        <button
          type="button"
          onClick={load}
          style={{
            width: "100%", textAlign: "left", fontSize: 11.5, lineHeight: 1.5,
            color: "var(--nova-ink-faint)", background: "var(--nova-glass-bg)",
            border: "1px dashed var(--nova-glass-border)", borderRadius: 8,
            padding: "8px 10px", cursor: "pointer",
          }}
        >
          Get market signals for {account.name}
        </button>
      )}

      {loading && (
        <div style={{ fontSize: 11.5, color: "var(--nova-ink-faint)" }}>Searching the web…</div>
      )}

      {error && !loading && (
        <div style={{ fontSize: 11, color: "var(--nova-orange-soft)", lineHeight: 1.5 }}>
          {error}{" "}
          <button type="button" onClick={load} style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: "inherit" }}>Retry</button>
        </div>
      )}

      {data && !loading && (
        <div>
          <p style={{
            fontSize: 11.5, color: "var(--nova-ink-dim)", lineHeight: 1.5, margin: "0 0 8px",
            display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {data.summary}
          </p>
          {data.signals.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {data.signals.slice(0, 3).map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: TONE_DOT[s.tone], flexShrink: 0, marginTop: 5 }} />
                  <span style={{ fontSize: 11, color: TONE_COLOR[s.tone] }}>{s.headline}</span>
                </div>
              ))}
            </div>
          )}
          <Link href={`/accounts/${account.id}?tab=overview`} style={{ display: "block", marginTop: 8, fontSize: 10.5, color: "var(--nova-pink-soft)", textDecoration: "none" }}>
            Open account →
          </Link>
        </div>
      )}
    </div>
  );
}
