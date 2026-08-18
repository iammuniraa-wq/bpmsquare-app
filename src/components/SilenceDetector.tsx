"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";

/**
 * Silence Detector — engagement layer, 3-layer theme only (the parent
 * gates on useIsNextgen3Layer, this component only fetches and draws).
 *
 * Shows accounts whose own ordering rhythm says they've gone quiet, and
 * counts a "Save" when someone reaches out before the drift. Renders
 * nothing at all while a tenant is too young to have rhythms — an empty
 * coach is worse than no coach.
 */

type SilenceAccount = {
  account_id: string; name: string;
  rhythm_days: number; days_since: number;
  state: "due" | "overdue";
  recently_saved: boolean;
};

const TONE = {
  due:     { ink: "#a16207", bg: "rgba(244,183,64,.12)",  label: "Window opening" },
  overdue: { ink: "#c2402f", bg: "rgba(255,122,102,.12)", label: "Past rhythm" },
} as const;

export default function SilenceDetector() {
  const [accounts, setAccounts] = useState<SilenceAccount[] | null>(null);
  const [saves, setSaves] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/engagement/silence");
      if (!res.ok) { setAccounts([]); return; }
      const json = await res.json();
      setAccounts(json.accounts ?? []);
      setSaves(json.saves_this_month ?? 0);
    } catch { setAccounts([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(accountId: string) {
    setSaving(accountId);
    try {
      const res = await fetch("/api/engagement/silence", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });
      if (res.ok) {
        setSavedIds((prev) => new Set(prev).add(accountId));
        setSaves((n) => n + 1);
      }
    } finally { setSaving(null); }
  }

  if (!accounts || accounts.length === 0) return null;

  return (
    <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <polyline points="1.5,9 4.5,9 6.5,4.5 8.5,12 10.5,7 11.5,9 14.5,9"
            fill="none" stroke={c.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 650, color: c.ink }}>Going quiet</span>
        <span style={{ fontSize: 11, color: c.hint }}>learned from each account&apos;s own order rhythm</span>
        {saves > 0 && (
          <span style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#148a5b",
            background: "rgba(62,207,142,.12)", padding: "3px 10px", borderRadius: 999,
          }}>
            {saves} save{saves === 1 ? "" : "s"} this month
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {accounts.map((a) => {
          const saved = savedIds.has(a.account_id);
          const tone = TONE[a.state];
          return (
            <div key={a.account_id} style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "10px 12px", borderRadius: 10,
              border: `1px solid ${saved ? "rgba(62,207,142,.45)" : "var(--line)"}`,
              background: "var(--panel2)",
            }}>
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <Link href={ROUTES.account(a.account_id)} style={{ fontSize: 13, fontWeight: 600, color: c.ink, textDecoration: "none" }}>
                  {a.name}
                </Link>
                <div style={{ fontSize: 11, color: c.muted }}>
                  Orders every ~{a.rhythm_days} days · day <b style={{ fontVariantNumeric: "tabular-nums" }}>{a.days_since}</b>
                </div>
              </div>
              {saved ? (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#148a5b", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 1.6 13.3 3.5v4.4c0 3.3-2.2 5.3-5.3 6.5C4.9 13.2 2.7 11.2 2.7 7.9V3.5L8 1.6Z" fill="none" stroke="#148a5b" strokeWidth="1.5" strokeLinejoin="round" />
                    <polyline points="5.6,8 7.3,9.7 10.4,6.3" fill="none" stroke="#148a5b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Counted as a save
                </span>
              ) : (
                <>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, color: tone.ink, background: tone.bg }}>
                    {tone.label}
                  </span>
                  <button
                    onClick={() => save(a.account_id)}
                    disabled={saving === a.account_id}
                    style={{
                      fontSize: 11.5, fontWeight: 650, cursor: "pointer",
                      padding: "6px 12px", borderRadius: 8, border: "none", color: "#fff",
                      background: c.accent, opacity: saving === a.account_id ? .6 : 1,
                    }}
                  >
                    I reached out
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
