"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import { canNest, MAX_LEVEL } from "@/lib/wfm/projectTree";
import { useUserRole } from "@/lib/tenant-context";
import { useFeel } from "@/components/FeelProvider";

type Row = { key: string; total_minutes: number; own_minutes: number; employees: number };
type Meta = { name: string; ref: string | null; status: string; parent_id: string | null; depth: number };

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;

/**
 * The sub-projects under one project, as a tree.
 *
 * Read and navigate only. Creating one opens the full project form
 * (owner decision 2026-09-06): a sub-project has everything a project has --
 * people, shifts, sites, dates, a budget -- and an inline name box could set
 * none of it, which is the whole reason a WBS exists. So + here carries you
 * to that form with "Sits under" already pointing at the right row.
 *
 * Levels are the depth: the project is Level 0, its sub-projects Level 1, down
 * to Level 3.
 */
export default function SubItems({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [projects, setProjects] = useState<Record<string, Meta>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const isAdmin = useUserRole() === "admin";
  const { confirm } = useFeel();

  const load = useCallback(async () => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const r = await fetch(`/api/wfm/projects/hours?from=${from}&to=${to}`).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    if (j) {
      setProjects(j.projects ?? {});
      setRows(j.rows ?? []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load, projectId]);

  const minutesOf = (id: string) => rows.find((r) => r.key === id)?.total_minutes ?? 0;
  const childrenOf = (id: string) =>
    Object.entries(projects)
      .filter(([, m]) => m.parent_id === id)
      .map(([cid, m]) => ({ id: cid, ...m }))
      .sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));

  async function remove(id: string, name: string) {
    const kids = childrenOf(id).length;
    const ok = await confirm({
      title: `Delete “${name}”?`,
      body: kids > 0
        ? `It has ${kids} sub-project${kids === 1 ? "" : "s"} inside it — delete or move those first.`
        : "Hours already booked to it become unassigned. The punches themselves are kept, so nobody's attendance changes.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setError("");
    const res = await fetch(`/api/wfm/projects/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res) { setError("Network error — nothing was deleted."); return; }
    const json = await res.json().catch(() => ({}));
    // The API refuses while anything still sits underneath (their parent would
    // be nulled and they would reappear as top-level projects).
    if (!res.ok) { setError(json.error ?? "Could not delete that."); return; }
    await load();
  }

  if (!loaded) return null;

  const myDepth = projects[projectId]?.depth ?? 0;
  if (!canNest(myDepth)) return null;

  const kids = childrenOf(projectId);
  if (kids.length === 0 && !isAdmin) return null;

  const tone = pillar.teal;
  const iconBtn: React.CSSProperties = {
    flexShrink: 0, width: 26, height: 26, borderRadius: 7, cursor: "pointer",
    border: `1px solid ${c.line}`, background: "transparent", color: c.muted,
    fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
    textDecoration: "none",
  };

  const addLink = (parent: string, label: string) => (
    <Link href={`${ROUTES.wfmProjectNew}?parent=${parent}`} title={label} aria-label={label} style={iconBtn}>
      +
    </Link>
  );

  function branch(id: string, depth: number): React.ReactNode {
    return (
      <>
        {childrenOf(id).map((ch) => {
          const grandkids = childrenOf(ch.id);
          const isOpen = open[ch.id] === true;
          return (
            <div key={ch.id}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 0", paddingLeft: depth * 18, borderTop: `1px solid ${c.line}`,
              }}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [ch.id]: !isOpen }))}
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  style={{
                    width: 16, flexShrink: 0, background: "none", border: "none", padding: 0,
                    color: c.hint, fontSize: 10, cursor: grandkids.length ? "pointer" : "default",
                    visibility: grandkids.length ? "visible" : "hidden",
                    transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s",
                  }}
                >▸</button>

                <Link
                  href={ROUTES.wfmProject(ch.id)}
                  style={{
                    flex: 1, minWidth: 0, color: tone.fg, fontWeight: 600, fontSize: 13.5,
                    textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {ch.name}
                </Link>

                <span className="mob-hide" style={{
                  flexShrink: 0, fontSize: 10.5, fontWeight: 600, color: c.hint, background: c.panel2,
                  border: `1px solid ${c.line}`, borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap",
                }}>
                  Level {ch.depth}
                </span>
                <span className="mob-hide" style={{ flexShrink: 0, fontSize: 11.5, color: c.hint, minWidth: 90, textAlign: "right" }}>
                  {ch.ref ?? "—"}
                </span>
                <span style={{ flexShrink: 0, fontSize: 13, fontVariantNumeric: "tabular-nums", color: c.ink, minWidth: 66, textAlign: "right" }}>
                  {hm(minutesOf(ch.id))}
                </span>

                {isAdmin && canNest(ch.depth)
                  ? addLink(ch.id, `Add a sub-project under ${ch.name}`)
                  : <span style={{ width: 26 }} />}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => remove(ch.id, ch.name)}
                    title={`Delete ${ch.name}`}
                    aria-label={`Delete ${ch.name}`}
                    style={{ ...iconBtn, fontSize: 13, color: c.hint }}
                  >✕</button>
                )}
              </div>
              {isOpen && branch(ch.id, depth + 1)}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <section style={{ ...cardStyle, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>Sub-projects</span>
        <span style={{ fontSize: 12.5, color: c.muted, flex: 1, minWidth: 160 }}>
          {kids.length > 0
            ? "Each has its own people, shifts and sites. Hours roll up into this project."
            : `Optional. Up to Level ${MAX_LEVEL} — each one is a full project in its own right.`}
        </span>
        {isAdmin && addLink(projectId, "Create a sub-project")}
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--err-ink)", marginTop: 10 }}>{error}</div>}

      <div style={{ marginTop: 10 }}>{branch(projectId, 0)}</div>

      {kids.length === 0 && (
        <div style={{ fontSize: 12.5, color: c.hint, marginTop: 10, lineHeight: 1.5 }}>
          None yet — hours can sit on the project itself. <strong>+</strong> opens the same form
          you filled in for this project, with people, shifts and sites of its own.
        </div>
      )}
    </section>
  );
}
