"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";

type Row = { key: string; total_minutes: number; own_minutes: number; employees: number };
type Meta = { name: string; ref: string | null; status: string; parent_id: string | null; depth: number };

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;

/**
 * The sub-items beneath one project — a WBS, a phase, whatever this tenant
 * calls the level below — each with the hours rolled up into it.
 *
 * Renders nothing at all when the tenant has no levels configured, or when
 * this item is already at the deepest one. A flat tenant never learns the
 * feature exists.
 */
export default function SubItems({ projectId }: { projectId: string }) {
  const [levels, setLevels] = useState<string[] | null>(null);
  const [projects, setProjects] = useState<Record<string, Meta>>({});
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    fetch(`/api/wfm/projects/hours?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) { setLevels([]); return; }
        setLevels(j.levels ?? []);
        setProjects(j.projects ?? {});
        setRows(j.rows ?? []);
      })
      .catch(() => setLevels([]));
  }, [projectId]);

  if (levels === null) return null;

  const me = projects[projectId];
  const myDepth = me?.depth ?? 0;
  // The tenant's word for the level BELOW this one. Null means this item is
  // already as deep as they allow, so there is nothing to add or show.
  const childLevel = myDepth < levels.length ? levels[myDepth] : null;
  if (!childLevel) return null;

  const minutesOf = (id: string) => rows.find((r) => r.key === id)?.total_minutes ?? 0;
  const children = Object.entries(projects)
    .filter(([, m]) => m.parent_id === projectId)
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => minutesOf(b.id) - minutesOf(a.id));

  const tone = pillar.teal;

  return (
    <section style={{ ...cardStyle, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>{childLevel}</span>
        <span style={{ fontSize: 12.5, color: c.muted }}>
          Break this project into as many parts as you need and put people on each one.
          Hours roll up here.
        </span>
        <Link
          href={`${ROUTES.wfmProjectNew}?parent=${projectId}`}
          style={{
            marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: c.accent,
            textDecoration: "none", whiteSpace: "nowrap",
          }}
        >
          + Add {childLevel}
        </Link>
      </div>

      {children.length === 0 ? (
        <div style={{ fontSize: 12.5, color: c.hint, marginTop: 12, lineHeight: 1.5 }}>
          No {childLevel} yet. You don&apos;t have to use them — hours can sit on the project
          itself.
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {children.map((ch) => (
            <div
              key={ch.id}
              style={{
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                padding: "10px 0", borderTop: `1px solid ${c.line}`,
              }}
            >
              <Link
                href={ROUTES.wfmProject(ch.id)}
                style={{ flex: 1, minWidth: 160, color: tone.fg, fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}
              >
                {ch.name}
              </Link>
              {ch.ref && <span style={{ fontSize: 11.5, color: c.hint }}>{ch.ref}</span>}
              <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: c.ink, minWidth: 76, textAlign: "right" }}>
                {hm(minutesOf(ch.id))}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
