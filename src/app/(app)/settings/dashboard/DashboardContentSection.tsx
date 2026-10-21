"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { Section } from "@/components/settings/generalShared";
import { settingsInput as inp } from "@/components/settings/SettingsField";
import { useTenant } from "@/lib/tenant-context";
import { DEFAULT_NEWS_TOPICS_LABEL } from "@/lib/constants";
import InfoTip from "@/components/ui/InfoTip";
import { SETTINGS_TIPS } from "@/lib/settingsTips";

type Extras = { business_news?: boolean; product_tips?: boolean; news_topics?: string[] };

/**
 * Dashboard content blocks (owner request 2026-09-20).
 *
 * The problem: "if the client is not using the system then there is no data to
 * represent" -- a freshly provisioned workspace opens on a dashboard of zeroes.
 * These two blocks carry their own content, so the dashboard says something
 * useful from the first login and keeps doing so afterwards.
 *
 * ADMIN-CONTROLLED, ON PURPOSE (owner's choice over per-user blocks, or blocks
 * that disappear once real data shows up): what the team sees on the dashboard
 * stays one decision rather than drifting person by person. When a block is on
 * it is forced visible even for someone whose saved layout had hidden it --
 * they can still move and resize it like any other block.
 *
 * Both default OFF. An existing workspace's dashboard does not change until an
 * admin comes here and switches one on.
 */
export default function DashboardContentSection({ accent }: { accent: string }) {
  const tenant = useTenant();
  const saved = (tenant?.config?.dashboard_extras ?? {}) as Extras;

  const [news, setNews] = useState(saved.business_news === true);
  const [tips, setTips] = useState(saved.product_tips === true);
  const [topics, setTopics] = useState((saved.news_topics ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const parsedTopics = topics.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4);
  const dirty =
    news !== (saved.business_news === true) ||
    tips !== (saved.product_tips === true) ||
    parsedTopics.join("|") !== (saved.news_topics ?? []).join("|");

  async function save() {
    setSaving(true); setError(""); setDone(false);
    const r = await fetch("/api/settings/entities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dashboard_extras: { business_news: news, product_tips: tips, news_topics: parsedTopics },
      }),
    }).catch(() => null);
    setSaving(false);
    if (!r) { setError("Network error"); return; }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Could not save");
      return;
    }
    setDone(true);
    // The dashboard reads this from tenant context, which is server-rendered --
    // a reload is what makes the change visible, so say so rather than leaving
    // the admin wondering why the dashboard looks the same.
    setTimeout(() => setDone(false), 2500);
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <Section title="">
        <Row
          label="Business news"
          hint={SETTINGS_TIPS.businessNews}
          on={news} onChange={setNews} accent={accent}
        />

        {news && (
          <div style={{ margin: "0 0 14px", paddingLeft: 2 }}>
            <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 4 }}>
              Topics — comma separated, up to 4
            </label>
            <input
              style={{ ...inp, width: "100%" }}
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder={DEFAULT_NEWS_TOPICS_LABEL}
            />
          </div>
        )}

        <Row
          label="Tips & shortcuts"
          hint={SETTINGS_TIPS.productTips}
          on={tips} onChange={setTips} accent={accent}
        />

        <SettingsSave dirty={dirty} saving={saving} saved={done} error={error} onSave={save} />
      </Section>
    </div>
  );
}

function Row({ label, hint, on, onChange, accent }: {
  label: string; hint: React.ReactNode; on: boolean; onChange: (v: boolean) => void; accent: string;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        style={{
          width: 34, height: 20, borderRadius: 999, flexShrink: 0, marginTop: 1,
          background: on ? accent : "var(--surface-sunken)",
          border: `1px solid ${on ? accent : "var(--line)"}`,
          position: "relative", cursor: "pointer", padding: 0,
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: on ? 16 : 2,
          width: 14, height: 14, borderRadius: "50%", background: "#fff",
          transition: "left .14s ease",
        }} />
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{label}</span>
          <InfoTip label={label}>{hint}</InfoTip>
        </div>
      </div>
    </div>
  );
}
