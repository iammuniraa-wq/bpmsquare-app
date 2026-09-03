"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { c, pillar, statusInk } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Donut from "@/components/Donut";

const UNASSIGNED = "__unassigned__";

// Amber is reserved for the unassigned slice, so it isn't in the rotation.
const PALETTE = [pillar.blue.base, pillar.teal.base, pillar.purple.base, pillar.green.base, pillar.red.base];

type Row = { key: string; net_minutes: number; sessions: number; employees: number };
type Payload = {
  rows: Row[];
  projects: Record<string, { name: string; ref: string | null; status: string }>;
  pending_migration?: boolean;
};

/** h:mm, never decimal hours -- the client's accountant read 12.98 as
 *  "12 hours 98" when it is 12h 59m (reported 2026-08-31). Same rule the
 *  payroll export follows. */
function fmtHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * Month-to-date hours per project, above the projects table.
 *
 * The unassigned slice is deliberately given equal prominence rather than
 * being tucked away: if most hours aren't attributed, that IS the headline,
 * and a supervisor can only fix what they can see.
 */
export default function ProjectHoursTiles({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/wfm/projects/hours?from=${from}&to=${to}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) { setError(j.error ?? "Could not load project hours"); return; }
        setData(j);
      })
      .catch(() => setError("Network error"));
  }, [from, to]);

  if (error) return <div style={{ fontSize: 12.5, color: statusInk.bad, padding: "8px 0" }}>{error}</div>;
  if (!data) return <div style={{ fontSize: 12.5, color: c.hint, padding: "8px 0" }}>Loading hours…</div>;
  if (data.rows.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: c.hint, padding: "10px 0" }}>
        No hours booked this month yet. Hours appear here as people punch in.
      </div>
    );
  }

  const total = data.rows.reduce((s, r) => s + r.net_minutes, 0);
  const unassigned = data.rows.find((r) => r.key === UNASSIGNED)?.net_minutes ?? 0;
  const top = data.rows.slice(0, 6);

  const label = (key: string) =>
    key === UNASSIGNED ? "Unassigned" : data.projects[key]?.name ?? "Unknown project";

  return (
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", margin: "4px 0 14px" }}>
      <Donut
        title="Hours this month"
        centerLabel={fmtHM(total)}
        slices={top.map((r, i) => ({
          label: label(r.key),
          value: r.net_minutes,
          // Unassigned is amber wherever it lands -- it reads as something to
          // deal with, not as just another project in the rotation.
          color: r.key === UNASSIGNED ? pillar.amber.base : PALETTE[i % PALETTE.length],
        }))}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 240 }}>
        {top.map((r) => (
          <div key={r.key} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5 }}>
            <span style={{ flex: 1, color: r.key === UNASSIGNED ? statusInk.warn : c.ink, fontWeight: r.key === UNASSIGNED ? 600 : 500 }}>
              {r.key === UNASSIGNED ? (
                "Unassigned"
              ) : (
                <Link href={ROUTES.wfmProject(r.key)} style={{ color: c.ink, textDecoration: "none" }}>
                  {label(r.key)}
                </Link>
              )}
            </span>
            <span style={{ color: c.muted, fontVariantNumeric: "tabular-nums" }}>{fmtHM(r.net_minutes)}</span>
            <span style={{ color: c.hint, fontSize: 11.5, minWidth: 58, textAlign: "right" }}>
              {r.employees} {r.employees === 1 ? "person" : "people"}
            </span>
          </div>
        ))}

        {unassigned > 0 && (
          <div style={{ marginTop: 4, fontSize: 11.5, color: c.hint, maxWidth: 320, lineHeight: 1.45 }}>
            Unattributed hours come from punches with no roster project and no single
            active project at the site. Set a project on the{" "}
            <Link href={ROUTES.wfmRoster} style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}>
              roster
            </Link>{" "}
            to attribute future punches.
          </div>
        )}
      </div>
    </div>
  );
}
