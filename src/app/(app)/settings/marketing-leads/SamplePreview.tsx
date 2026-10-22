"use client";

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import { SettingsField, settingsInput } from "@/components/settings/SettingsField";
import { computeLeadScore, type ScoringEvent, type ScoringRubric } from "@/lib/marketing/scoring";
import { SCORING_TIPS } from "@/lib/marketing/scoringTips";

// "Try it": pretend a lead did some things and see what the rules make of it. Nothing is saved or sent.

const input44: React.CSSProperties = { ...settingsInput, minHeight: 44 };

export default function SamplePreview({ rubric }: { rubric: ScoringRubric }) {
  const [counts, setCounts] = useState<Record<number, { n: number; days: number }>>({});
  const [profile, setProfile] = useState({ type: "", country: "", contact_role: "", has_active_amc: false });

  const result = useMemo(() => {
    const now = new Date();
    const evs: ScoringEvent[] = [];
    rubric.behaviour.forEach((b, i) => {
      const s = counts[i];
      if (!s || s.n <= 0) return;
      for (let k = 0; k < Math.min(50, s.n); k++) {
        evs.push({ name: b.event, occurred_at: new Date(now.getTime() - s.days * 86_400_000).toISOString(), payload: b.match ? { ...b.match } : {} });
      }
    });
    return computeLeadScore(rubric, evs, { ...profile, has_active_amc: profile.has_active_amc }, null, now);
  }, [rubric, counts, profile]);

  const field = (label: string, key: "type" | "country" | "contact_role", help: string) => (
    <SettingsField label={label} help={help}>
      <input value={profile[key]} aria-label={label} style={input44} onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))} />
    </SettingsField>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {field("Account type", "type", SCORING_TIPS.accountType)}
      {field("Country", "country", SCORING_TIPS.country)}
      {field("Their role", "contact_role", SCORING_TIPS.role)}
      <SettingsField label="Has a service contract" help={SCORING_TIPS.serviceContract}>
        <div style={{ minHeight: 44, display: "flex", alignItems: "center" }}>
          <input type="checkbox" checked={profile.has_active_amc} aria-label="Has a service contract" onChange={(e) => setProfile((p) => ({ ...p, has_active_amc: e.target.checked }))} style={{ width: 20, height: 20, accentColor: c.accent }} />
        </div>
      </SettingsField>
      {rubric.behaviour.filter((b) => b.points !== 0).map((b) => {
        const i = rubric.behaviour.indexOf(b);
        const s = counts[i] ?? { n: 0, days: 1 };
        return (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 200px", fontSize: 13 }}>{b.label}</span>
            <label style={{ fontSize: 12.5, color: c.muted }}>times <input type="number" min={0} max={50} value={s.n} style={{ ...input44, width: 72, marginLeft: 6 }} onChange={(e) => setCounts((x) => ({ ...x, [i]: { ...s, n: Number(e.target.value) || 0 } }))} /></label>
            <label style={{ fontSize: 12.5, color: c.muted }}>days ago <input type="number" min={0} max={365} value={s.days} style={{ ...input44, width: 72, marginLeft: 6 }} onChange={(e) => setCounts((x) => ({ ...x, [i]: { ...s, days: Number(e.target.value) || 0 } }))} /></label>
          </div>
        );
      })}
      <div role="status" aria-live="polite" style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: c.ink }}>{result.score}</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{result.label}</span>
        </div>
        {result.factors.length === 0 ? (
          <p className="bpm-t-help" style={{ margin: "4px 0 0" }}>No points yet. Add something above.</p>
        ) : (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: c.ink }}>
            {result.factors.map((f, i) => (
              <li key={i}>
                <strong>{f.points > 0 ? `+${f.points}` : f.points}</strong> {f.label}
                <span className="bpm-t-help"> — {f.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
