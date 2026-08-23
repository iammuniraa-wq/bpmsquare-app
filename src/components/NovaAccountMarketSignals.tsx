"use client";

import { useEffect, useState } from "react";
import type { MarketIntelResult } from "@/lib/nova/marketIntel";
import { readMarketIntelCache, fetchMarketIntel } from "@/lib/nova/marketIntelClient";

/**
 * Market Signals -- real, live web search about this account's company
 * (owner request 2026-08-25: "market analysis and signals... so sales
 * users can get an idea what is happening with their accounts"). Unlike
 * Account 360's other cards, this is deliberately NOT auto-fetched: a real
 * web-search-enabled Claude call is slow and billed, so it only runs on an
 * explicit click, and the result is cached per tab for 6h (see
 * marketIntelClient.ts) so revisiting the account doesn't re-trigger it.
 */
const TONE_COLOR: Record<"positive" | "neutral" | "risk", string> = {
  positive: "var(--nova-teal-soft)",
  neutral: "var(--nova-ink-dim)",
  risk: "var(--nova-orange-soft)",
};
const TONE_BG: Record<"positive" | "neutral" | "risk", string> = {
  positive: "var(--nova-teal-bg)",
  neutral: "var(--nova-glass-bg)",
  risk: "var(--nova-orange-bg)",
};

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export default function NovaAccountMarketSignals({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [data, setData] = useState<MarketIntelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(readMarketIntelCache(accountId));
  }, [accountId]);

  function load() {
    setLoading(true);
    setError(null);
    fetchMarketIntel(accountId, accountName)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="nova-display" style={{ fontSize: 16 }}>Market signals</div>
        {data && !loading && (
          <button type="button" onClick={load} style={{ fontSize: 11, color: "var(--nova-ink-faint)", background: "none", border: "none", cursor: "pointer" }}>
            Refresh · {timeAgo(data.fetchedAt)}
          </button>
        )}
      </div>

      {!data && !loading && !error && (
        <button
          type="button"
          onClick={load}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            background: "var(--nova-glass-bg)", border: "1px dashed var(--nova-glass-border)",
            borderRadius: "var(--nova-radius-card)", padding: "16px 18px", cursor: "pointer",
            textAlign: "left", color: "var(--nova-ink-dim)", fontSize: 13,
          }}
        >
          <span style={{ fontSize: 16 }}>◎</span>
          Get real, live signals about this company — news, funding, leadership changes — before your next call.
        </button>
      )}

      {loading && (
        <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "18px", fontSize: 13, color: "var(--nova-ink-faint)" }}>
          Searching the web for {`what's`} happening with this account…
        </div>
      )}

      {error && !loading && (
        <div style={{ border: "1px solid rgba(255,107,53,0.35)", background: "var(--nova-orange-bg)", borderRadius: "var(--nova-radius-card)", padding: "14px 16px", fontSize: 12.5, color: "var(--nova-orange-soft)" }}>
          {error} <button type="button" onClick={load} style={{ marginLeft: 8, background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: "inherit" }}>Try again</button>
        </div>
      )}

      {data && !loading && (
        <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "16px 18px" }}>
          <p style={{ fontSize: 13, color: "var(--nova-ink-dim)", margin: "0 0 14px", lineHeight: 1.6 }}>{data.summary}</p>

          {data.signals.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: data.sources.length > 0 ? 14 : 0 }}>
              {data.signals.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: TONE_BG[s.tone], borderRadius: 9, padding: "9px 12px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: TONE_COLOR[s.tone], flexShrink: 0, minWidth: 110 }}>{s.headline}</span>
                  <span style={{ fontSize: 12.5, color: "var(--nova-ink-dim)", lineHeight: 1.5 }}>{s.detail}</span>
                </div>
              ))}
            </div>
          )}

          {data.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {data.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--nova-ink-faint)", textDecoration: "none", border: "1px solid var(--nova-glass-border)", borderRadius: 6, padding: "3px 8px" }}>
                  {s.title} ↗
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
