"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import { matchMethodTemplate, type MethodTemplate } from "@/lib/pricing/wizard";
import RateSnapshotView, { type SnapshotRule } from "../RateSnapshotView";

type VersionRow = { version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; published_at: string | null; created_at: string };
type Snapshot = { procedures: { code: string; entry_mode: string }[]; rules: SnapshotRule[] };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function HistoryClient() {
  const searchParams = useSearchParams();
  const area = searchParams.get("area") || "default";
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<{ template: MethodTemplate | null; rules: SnapshotRule[] } | "loading" | null>(null);
  const [asOfDate, setAsOfDate] = useState("");

  useEffect(() => {
    setVersions(null);
    setSelected(null);
    (async () => {
      const res = await fetch(`/api/settings/pricing-engine/versions?area=${encodeURIComponent(area)}`);
      const data = await res.json();
      const live: VersionRow[] = (data.versions ?? []).filter((v: VersionRow) => v.status !== "DRAFT");
      live.sort((a, b) => b.version - a.version);
      setVersions(live);
      const currentlyLive = live.find((v) => v.status === "PUBLISHED");
      setSelected((currentlyLive ?? live[0])?.version ?? null);
    })();
  }, [area]);

  useEffect(() => {
    if (selected === null) return;
    setSnapshot("loading");
    (async () => {
      const res = await fetch(`/api/settings/pricing-engine/versions/${selected}?area=${encodeURIComponent(area)}`);
      const snap: Snapshot = await res.json();
      setSnapshot({ template: matchMethodTemplate(snap.procedures), rules: snap.rules });
    })();
  }, [selected, area]);

  const asOfVersion = useMemo(() => {
    if (!asOfDate || !versions) return null;
    const target = new Date(asOfDate).getTime();
    const candidates = versions
      .filter((v) => v.published_at && new Date(v.published_at).getTime() <= target)
      .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime());
    return candidates[0] ?? null;
  }, [asOfDate, versions]);

  if (!versions) {
    return <div style={{ padding: 24, color: c.muted, fontSize: 13 }}>Loading…</div>;
  }

  if (versions.length === 0) {
    return (
      <div style={{ padding: 24, borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel, textAlign: "center", fontSize: 13, color: c.muted }}>
        Nothing has gone live yet — history starts the first time you go live from Pricing setup.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, alignItems: "start" }}>
      <div>
        <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel }}>
          <label style={{ fontSize: 11.5, color: c.muted, fontWeight: 600, display: "block", marginBottom: 6 }}>What was live on a date</label>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => {
              setAsOfDate(e.target.value);
              const found = versions
                .filter((v) => v.published_at && new Date(v.published_at).getTime() <= new Date(e.target.value).getTime())
                .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime())[0];
              if (found) setSelected(found.version);
            }}
            style={{ width: "100%", padding: "6px 8px", fontSize: 13, borderRadius: 6, border: `1px solid ${c.line}`, background: c.bg2, color: c.ink }}
          />
          {asOfDate && !asOfVersion && (
            <div style={{ fontSize: 11.5, color: c.muted, marginTop: 6 }}>Nothing was live yet on this date.</div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {versions.map((v) => {
            const isSelected = v.version === selected;
            const isLive = v.status === "PUBLISHED";
            return (
              <button
                key={v.version}
                onClick={() => setSelected(v.version)}
                style={{
                  textAlign: "left", padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${isSelected ? c.accent : c.line}`,
                  background: isSelected ? c.accentbg : c.panel,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{formatDate(v.published_at)}</span>
                  <span
                    style={{
                      fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                      background: isLive ? pillar.green.bg : c.bg2, color: isLive ? pillar.green.fg : c.muted,
                    }}
                  >
                    {isLive ? "Live" : "Replaced"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {snapshot === "loading" && <div style={{ fontSize: 13, color: c.muted }}>Loading…</div>}
        {snapshot && snapshot !== "loading" && snapshot.template && (
          <RateSnapshotView template={snapshot.template} rules={snapshot.rules} />
        )}
        {snapshot && snapshot !== "loading" && !snapshot.template && (
          <div style={{ fontSize: 12.5, color: c.muted }}>This version was set up in Advanced.</div>
        )}
      </div>
    </div>
  );
}
