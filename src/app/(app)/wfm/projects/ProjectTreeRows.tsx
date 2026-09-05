"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { WfmProject, WfmProjectStatus } from "@/lib/wfm/types";
import { canNest, depthOf } from "@/lib/wfm/projectTree";
import { useUserRole } from "@/lib/tenant-context";

const STATUS_LABEL: Record<WfmProjectStatus, string> = {
  planned: "Planned", active: "Active", on_hold: "On hold",
  completed: "Completed", cancelled: "Cancelled",
};
const STATUS_TONE: Record<WfmProjectStatus, "green" | "amber" | "red" | "blue" | "purple"> = {
  planned: "blue", active: "green", on_hold: "amber",
  completed: "purple", cancelled: "red",
};

const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * The Projects list as a tree you build in place (owner decision 2026-09-06:
 * "select the project here and create sub-projects under it from here").
 *
 * Every row carries a + on the right. It opens a name box directly beneath
 * that row; Enter creates the sub-project one level down and it appears in
 * the tree. The + on a project makes a Level 1, on a Level 1 a Level 2, and so
 * on to Level 3, where it stops being offered. Creating needs a name and
 * nothing else -- exactly what creating a project needs -- and everything
 * else (people, shifts, sites, dates, budget) is edited by clicking the name,
 * as it is for a project.
 *
 * `rows` are the rows for this page; in tree view they are the top-level
 * projects and their descendants come from `all`. In a searched or sorted
 * view the same component renders them flat, with no tree affordances.
 */
export default function ProjectTreeRows({
  rows, all, tree,
}: {
  rows: WfmProject[];
  all: WfmProject[];
  tree: boolean;
}) {
  const router = useRouter();
  const isAdmin = useUserRole() === "admin";

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const nodes = new Map(all.map((p) => [p.id, { id: p.id, parent_id: p.parent_id }]));
  const depthFor = (id: string) => depthOf(nodes, id) ?? 0;
  const childrenOf = (id: string) =>
    all.filter((p) => p.parent_id === id)
      .sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));
  const byId = new Map(all.map((p) => [p.id, p]));

  function startAdd(parentId: string) {
    setError("");
    setName("");
    setAdding(parentId);
    setOpen((o) => ({ ...o, [parentId]: true }));
  }

  async function create(parentId: string) {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/wfm/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n, parent_id: parentId }),
    }).catch(() => null);
    setSaving(false);
    if (!res) { setError("Network error — nothing was saved."); return; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error ?? "Could not create it."); return; }
    // Stay put with the box open, so several go in one after another. The
    // refreshed list arrives from the server; this component keeps its state.
    setName("");
    router.refresh();
  }

  const iconBtn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 7, cursor: "pointer", flexShrink: 0,
    border: `1px solid ${c.line}`, background: "transparent", color: c.muted,
    fontSize: 15, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center",
  };

  function addRow(parentId: string, depth: number) {
    const parent = byId.get(parentId);
    return (
      <tr key={`add-${parentId}`} style={{ background: c.accentbg, borderBottom: `1px solid ${c.line}` }}>
        <td colSpan={8} style={{ ...td, paddingLeft: 14 + (depth + 1) * 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); create(parentId); }
                if (e.key === "Escape") setAdding(null);
              }}
              placeholder="Name of the new sub-project"
              style={{
                flex: "1 1 220px", maxWidth: 360, padding: "7px 10px", borderRadius: 7, fontSize: 13,
                border: `1px solid ${c.line}`, background: c.panel, color: c.ink,
              }}
            />
            <button
              type="button"
              onClick={() => create(parentId)}
              disabled={saving || !name.trim()}
              style={{
                padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, border: "none",
                background: name.trim() ? c.accent : c.line, color: name.trim() ? "#fff" : c.hint,
                cursor: name.trim() && !saving ? "pointer" : "default", whiteSpace: "nowrap",
              }}
            >
              {saving ? "Creating…" : `Create Level ${depth + 1} under ${parent?.name ?? "this"}`}
            </button>
            <button
              type="button"
              onClick={() => setAdding(null)}
              style={{ padding: "7px 10px", borderRadius: 7, fontSize: 12.5, background: "none", border: "none", color: c.muted, cursor: "pointer" }}
            >
              Cancel
            </button>
            {error && <span style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</span>}
          </div>
        </td>
      </tr>
    );
  }

  function row(p: WfmProject, depth: number): React.ReactNode {
    const kids = tree ? childrenOf(p.id) : [];
    const isOpen = open[p.id] === true;
    return (
      <Fragment key={p.id}>
        <tr style={{ borderBottom: `1px solid ${c.line}` }}>
          {/* On a phone the ref goes too: the indentation and Level badge
              already say where a row sits, and PRJ-0001.1.1 is what was
              pushing the + off the right edge. */}
          <td className="mob-hide" style={{ ...td, color: c.hint, fontSize: 12.5, whiteSpace: "nowrap" }}>{p.ref ?? "—"}</td>
          <td style={td}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, rowGap: 4, flexWrap: "wrap", paddingLeft: depth * 18 }}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [p.id]: !isOpen }))}
                aria-label={isOpen ? "Collapse" : "Expand"}
                style={{
                  width: 16, flexShrink: 0, background: "none", border: "none", padding: 0,
                  color: c.hint, fontSize: 10, cursor: kids.length ? "pointer" : "default",
                  visibility: kids.length ? "visible" : "hidden",
                  transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s",
                }}
              >▸</button>
              <Link href={ROUTES.wfmProject(p.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                {p.name}
              </Link>
              {depth > 0 && (
                <span style={{
                  fontSize: 10.5, fontWeight: 600, color: c.hint, background: c.panel2,
                  border: `1px solid ${c.line}`, borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap",
                }}>
                  Level {depth}
                </span>
              )}
              {kids.length > 0 && !isOpen && (
                <span style={{ fontSize: 12, color: c.hint, whiteSpace: "nowrap" }}>
                  {kids.length} sub-project{kids.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </td>
          {/* The four detail columns give way on a phone, so ID, name,
              status and the + stay reachable without a sideways scroll. */}
          <td className="mob-hide" style={{ ...td, color: c.muted }}>{p.code ?? "—"}</td>
          <td style={td}><Pill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} /></td>
          <td className="mob-hide" style={{ ...td, color: c.muted, whiteSpace: "nowrap" }}>{fmtDate(p.start_date)}</td>
          <td className="mob-hide" style={{ ...td, color: c.muted, whiteSpace: "nowrap" }}>{fmtDate(p.end_date)}</td>
          <td className="mob-hide" style={{ ...td, color: c.muted }}>{p.budget_hours ?? "—"}</td>
          <td style={{ ...td, textAlign: "right", width: 40 }}>
            {tree && isAdmin && canNest(depth) && (
              <button
                type="button"
                onClick={() => (adding === p.id ? setAdding(null) : startAdd(p.id))}
                title={`Add a sub-project under ${p.name}`}
                aria-label={`Add a sub-project under ${p.name}`}
                style={{
                  ...iconBtn,
                  border: `1px solid ${adding === p.id ? c.accent : c.line}`,
                  background: adding === p.id ? c.accentbg : "transparent",
                  color: adding === p.id ? c.accent : c.muted,
                }}
              >
                {adding === p.id ? "×" : "+"}
              </button>
            )}
          </td>
        </tr>
        {tree && (isOpen || adding === p.id) && kids.map((k) => row(k, depth + 1))}
        {tree && adding === p.id && addRow(p.id, depth)}
      </Fragment>
    );
  }

  return <tbody>{rows.map((p) => row(p, tree ? depthFor(p.id) : 0))}</tbody>;
}
