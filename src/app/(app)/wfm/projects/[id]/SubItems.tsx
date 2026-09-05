"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import { canNest, childLabelFrom } from "@/lib/wfm/projectTree";
import { useUserRole } from "@/lib/tenant-context";
import { useFeel } from "@/components/FeelProvider";

type Row = { key: string; total_minutes: number; own_minutes: number; employees: number };
type Meta = {
  name: string; ref: string | null; status: string;
  parent_id: string | null; depth: number; level_label: string | null;
};

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;

/** The default word for a project's parts. Overwritable on the first one --
 *  a client who runs phases or packages types their own -- but pre-filled,
 *  because being asked to invent a word before you can add anything is what
 *  made this confusing. */
const DEFAULT_LEVEL = "WBS";

/**
 * The parts of a project, built in place.
 *
 * Adding one used to navigate to the full New Project form and come back,
 * which meant leaving the project to add something inside it, and a
 * two-field form where "what do you call this kind of part" and "name" were
 * easy to swap (owner-reported 2026-09-06: a part called "structural works"
 * ended up labelled "Survey"). Now every level is a row in one tree: + on the
 * right opens an inline name box, Enter saves and leaves the box open for the
 * next one, and each row carries its own + for the level beneath it.
 *
 * The word for a level is asked once, on the FIRST part of a parent, next to
 * the name and pre-filled with "WBS". Every sibling after that inherits it.
 */
export default function SubItems({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [projects, setProjects] = useState<Record<string, Meta>>({});
  const [rows, setRows] = useState<Row[]>([]);

  // Which rows are expanded, which row's "+" is open, and the draft in it.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftLabel, setDraftLabel] = useState(DEFAULT_LEVEL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Creating and deleting are admin-only on the API; a supervisor can see
  // this tree but gets no controls that would only 403.
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
      .sort((a, b) => minutesOf(b.id) - minutesOf(a.id));

  /** What this parent's parts are called -- its existing children's word, or
   *  the draft the user is typing for the very first one. */
  const labelFor = (id: string) => childLabelFrom(childrenOf(id).map((ch) => ch.level_label));
  const hasKids = (id: string) => childrenOf(id).length > 0;

  function startAdd(parentId: string) {
    setError("");
    setDraftName("");
    setDraftLabel(hasKids(parentId) ? labelFor(parentId) : DEFAULT_LEVEL);
    setAdding(parentId);
    setOpen((o) => ({ ...o, [parentId]: true }));
  }

  async function save(parentId: string) {
    const name = draftName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/wfm/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        parent_id: parentId,
        level_label: (hasKids(parentId) ? labelFor(parentId) : draftLabel.trim()) || DEFAULT_LEVEL,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res) { setError("Network error — nothing was saved."); return; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error ?? "Could not add that."); return; }
    // Stay put with the box open, so several parts go in one after another.
    setDraftName("");
    await load();
  }

  async function remove(id: string, name: string) {
    const kids = childrenOf(id).length;
    const ok = await confirm({
      title: `Delete “${name}”?`,
      body: kids > 0
        ? `It has ${kids} part${kids === 1 ? "" : "s"} inside it — delete or move those first.`
        : "Hours already booked to it become unassigned. The punches themselves are kept, so nobody's attendance changes.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setError("");
    const res = await fetch(`/api/wfm/projects/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res) { setError("Network error — nothing was deleted."); return; }
    const json = await res.json().catch(() => ({}));
    // The API refuses to delete something with parts underneath (their parent
    // would be nulled and they would silently reappear as top-level projects).
    if (!res.ok) { setError(json.error ?? "Could not delete that."); return; }
    await load();
  }

  if (!loaded) return null;

  const myDepth = projects[projectId]?.depth ?? 0;
  if (!canNest(myDepth)) return null;

  const tone = pillar.teal;
  const topLabel = labelFor(projectId);
  const named = hasKids(projectId);
  // Nothing to show and nothing to do: a supervisor on a project with no
  // parts gets an empty card inviting them to press a button they don't have.
  if (!named && !isAdmin) return null;

  const plusBtn = (id: string, label: string) => (
    <button
      type="button"
      onClick={() => (adding === id ? setAdding(null) : startAdd(id))}
      title={label}
      aria-label={label}
      style={{
        flexShrink: 0, width: 26, height: 26, borderRadius: 7, cursor: "pointer",
        border: `1px solid ${adding === id ? c.accent : c.line}`,
        background: adding === id ? c.accentbg : "transparent",
        color: adding === id ? c.accent : c.muted,
        fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {adding === id ? "×" : "+"}
    </button>
  );

  function addRow(parentId: string, indent: number) {
    const first = !hasKids(parentId);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", paddingLeft: indent }}>
        {first && (
          <input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            aria-label="What these parts are called"
            title="What you call this kind of part — WBS, Phase, Package"
            style={{
              width: 92, padding: "7px 9px", borderRadius: 7, fontSize: 12.5, fontWeight: 600,
              border: `1px solid ${c.line}`, background: c.panel2, color: c.ink,
            }}
          />
        )}
        <input
          value={draftName}
          autoFocus
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(parentId); }
            if (e.key === "Escape") setAdding(null);
          }}
          placeholder={`Name of the ${(first ? draftLabel : labelFor(parentId)) || "part"}…`}
          style={{
            flex: "1 1 200px", minWidth: 0, padding: "7px 10px", borderRadius: 7, fontSize: 13,
            border: `1px solid ${c.line}`, background: c.panel, color: c.ink,
          }}
        />
        <button
          type="button"
          onClick={() => save(parentId)}
          disabled={saving || !draftName.trim()}
          style={{
            padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, border: "none",
            background: draftName.trim() ? c.accent : c.line,
            color: draftName.trim() ? "#fff" : c.hint,
            cursor: draftName.trim() && !saving ? "pointer" : "default",
          }}
        >
          {saving ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => setAdding(null)}
          style={{ padding: "7px 10px", borderRadius: 7, fontSize: 12.5, background: "none", border: "none", color: c.muted, cursor: "pointer" }}
        >
          Done
        </button>
      </div>
    );
  }

  function branch(id: string, depth: number): React.ReactNode {
    const kids = childrenOf(id);
    const indent = depth * 18;
    return (
      <>
        {kids.map((ch) => {
          const grandkids = childrenOf(ch.id);
          const expandable = grandkids.length > 0;
          const isOpen = open[ch.id] === true;
          return (
            <div key={ch.id}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 0", paddingLeft: indent, borderTop: `1px solid ${c.line}`,
              }}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [ch.id]: !isOpen }))}
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  style={{
                    width: 16, flexShrink: 0, background: "none", border: "none", padding: 0,
                    color: c.hint, fontSize: 10, cursor: expandable ? "pointer" : "default",
                    visibility: expandable ? "visible" : "hidden",
                    transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s",
                  }}
                >▸</button>
                {/* minWidth 0 so a long name truncates instead of pushing the
                    hours and the + off the card on a phone. */}
                <Link
                  href={ROUTES.wfmProject(ch.id)}
                  style={{
                    flex: 1, minWidth: 0, color: tone.fg, fontWeight: 600, fontSize: 13.5,
                    textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {ch.name}
                </Link>
                {ch.level_label?.trim() && (
                  <span className="mob-hide" style={{
                    flexShrink: 0, fontSize: 10.5, fontWeight: 600, color: c.hint, background: c.panel2,
                    border: `1px solid ${c.line}`, borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap",
                  }}>
                    {ch.level_label.trim()}
                  </span>
                )}
                {/* The ref is reference detail, not something you scan a list
                    by -- it is the first thing to go when the row is narrow. */}
                <span className="mob-hide" style={{ flexShrink: 0, fontSize: 11.5, color: c.hint, minWidth: 82, textAlign: "right" }}>
                  {ch.ref ?? "—"}
                </span>
                <span style={{ flexShrink: 0, fontSize: 13, fontVariantNumeric: "tabular-nums", color: c.ink, minWidth: 66, textAlign: "right" }}>
                  {hm(minutesOf(ch.id))}
                </span>
                {isAdmin && canNest(ch.depth)
                  ? plusBtn(ch.id, `Add a level under ${ch.name}`)
                  : <span style={{ width: 26 }} />}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => remove(ch.id, ch.name)}
                    title={`Delete ${ch.name}`}
                    aria-label={`Delete ${ch.name}`}
                    style={{
                      flexShrink: 0, width: 26, height: 26, borderRadius: 7, cursor: "pointer",
                      border: `1px solid ${c.line}`, background: "transparent", color: c.hint,
                      fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {(isOpen || adding === ch.id) && (
                <>
                  {branch(ch.id, depth + 1)}
                  {adding === ch.id && addRow(ch.id, indent + 18)}
                </>
              )}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <section style={{ ...cardStyle, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>
          {named ? topLabel : "Parts of this project"}
        </span>
        <span style={{ fontSize: 12.5, color: c.muted, flex: 1, minWidth: 160 }}>
          {named
            ? "Put people on each one — hours roll up into this project."
            : "Optional. Break this into parts if you track hours below project level."}
        </span>
        {isAdmin && plusBtn(projectId, named ? `Add a ${topLabel}` : "Break this project into parts")}
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--err-ink)", marginTop: 10 }}>{error}</div>}

      <div style={{ marginTop: 10 }}>
        {branch(projectId, 0)}
        {adding === projectId && addRow(projectId, 0)}
      </div>

      {!named && adding !== projectId && (
        <div style={{ fontSize: 12.5, color: c.hint, marginTop: 10, lineHeight: 1.5 }}>
          Nothing here yet — hours can sit on the project itself. Use <strong>+</strong> if you want
          WBS items, phases or packages underneath.
        </div>
      )}
    </section>
  );
}
