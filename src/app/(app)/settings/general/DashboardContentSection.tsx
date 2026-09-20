"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { settingsInput as inp } from "@/components/settings/SettingsField";
import { useTenant } from "@/lib/tenant-context";
import { DEFAULT_NEWS_TOPICS_LABEL } from "@/lib/constants";

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

  const on = [news && "Business news", tips && "Tips"].filter(Boolean) as string[];
  const summary = on.length ? on.join(" + ") : "Off";

  return (
    <div style={{ marginBottom: 12 }}>
      <SettingsSection id="general-dashboard-content" title="Dashboard content" summary={summary}>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: c.muted, lineHeight: 1.5 }}>
          Blocks that have something to show before this workspace has data of its own.
          Switching one on adds it to everyone&apos;s dashboard; they can move or resize it,
          but not remove it.
        </p>

        <Row
          label="Business news"
          hint="Headlines for the topics below. Unlike Client news, this needs no accounts — it has content on day one."
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
            <div style={{ fontSize: 10.5, color: c.hint, marginTop: 4 }}>
              Leave blank for the default: {DEFAULT_NEWS_TOPICS_LABEL}
            </div>
          </div>
        )}

        <Row
          label="Tips & shortcuts"
          hint="Rotating cards covering things the nav doesn't reveal — bulk import, custom fields, quote templates, API keys. Only tips for modules this workspace has are shown."
          on={tips} onChange={setTips} accent={accent}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
          <button
            onClick={save}
            disabled={!dirty || saving}
            style={{
              padding: "7px 14px", borderRadius: 8, border: "none",
              background: dirty && !saving ? accent : "var(--surface-sunken)",
              color: dirty && !saving ? "#fff" : c.hint,
              fontSize: 12.5, fontWeight: 600, cursor: dirty && !saving ? "pointer" : "default",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {done && <span style={{ fontSize: 11.5, color: c.muted }}>Saved — reload the dashboard to see it.</span>}
          {error && <span style={{ fontSize: 11.5, color: "var(--err-ink)" }}>{error}</span>}
        </div>
      </SettingsSection>
    </div>
  );
}

function Row({ label, hint, on, onChange, accent }: {
  label: string; hint: string; on: boolean; onChange: (v: boolean) => void; accent: string;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
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
        <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{label}</div>
        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, lineHeight: 1.5 }}>{hint}</div>
      </div>
    </div>
  );
}
