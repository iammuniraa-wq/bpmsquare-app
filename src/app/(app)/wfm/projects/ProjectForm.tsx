"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c, pillar, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { WfmProject, WfmProjectStatus } from "@/lib/wfm/types";
import { depthOf, descendantsOf, canNest, MAX_LEVEL } from "@/lib/wfm/projectTree";
import SettingsSection from "@/components/settings/SettingsSection";

const STATUSES: { value: WfmProjectStatus; label: string; hint: string }[] = [
  { value: "active", label: "Active", hint: "Collecting hours now" },
  { value: "planned", label: "Planned", hint: "Not started — collects nothing yet" },
  { value: "on_hold", label: "On hold", hint: "Paused — collects nothing" },
  { value: "completed", label: "Completed", hint: "Finished — stops collecting" },
  { value: "cancelled", label: "Cancelled", hint: "Collects nothing" },
];

const label: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const field: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 7, fontSize: 13.5,
  border: `1px solid ${c.line}`, background: c.panel2, color: c.ink,
};

type Option = { id: string; name: string };

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

/** The four ways a punch finds its project, in the order they are tried. Each
 *  is a real section on the form showing its OWN data -- an abstract list of
 *  rules above a set of unrelated pickers explained nothing. */
const RUNGS = {
  roster: { n: "1", title: "The roster", tone: pillar.blue, hint: "If a supervisor put someone on a project for that date, that wins." },
  people: { n: "2", title: "People", tone: pillar.teal, hint: "These employees, wherever they punch." },
  shifts: { n: "3", title: "Shifts", tone: pillar.purple, hint: "Everyone working that shift." },
  sites: { n: "4", title: "Sites", tone: pillar.amber, hint: "Anyone punching there — used only if nothing above applies." },
} as const;

type Rung = (typeof RUNGS)[keyof typeof RUNGS];

function RungHead({ rung, count }: { rung: Rung; count?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
      <span style={{
        width: 20, height: 20, borderRadius: 99, background: rung.tone.bg, color: rung.tone.fg,
        fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>{rung.n}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: rung.tone.fg }}>{rung.title}</span>
      <span style={{ fontSize: 12, color: c.hint }}>{rung.hint}</span>
      {count ? (
        <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: rung.tone.fg }}>
          {count} linked
        </span>
      ) : null}
    </div>
  );
}

/** Above this many options the list gets a search box and a cap. A tenant
 *  with 100 employees would otherwise get 100 chips in one wall, with the
 *  ones they had already chosen lost somewhere inside it. */
const SEARCH_FROM = 12;
const SHOW_MAX = 24;

function Picker({
  rung, options, selected, onToggle, empty, searchPlaceholder,
}: {
  rung: Rung;
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  empty: string;
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState("");

  const chip = (o: Option, on: boolean) => (
    <button
      key={o.id}
      type="button"
      onClick={() => onToggle(o.id)}
      style={{
        fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer",
        color: on ? rung.tone.fg : c.muted,
        background: on ? rung.tone.bg : c.panel2,
        border: `1px solid ${on ? rung.tone.base + "60" : c.line}`,
        borderRadius: 6, padding: "5px 11px",
      }}
    >
      {on ? "✓ " : ""}{o.name}
    </button>
  );

  const chosenIds = new Set(selected);
  // Chosen entries are rendered first and are NEVER filtered out by the
  // search -- you must always be able to see and undo what you picked, even
  // while searching for something else.
  const chosen = options.filter((o) => chosenIds.has(o.id));
  const needle = q.trim().toLowerCase();
  const rest = options.filter((o) => !chosenIds.has(o.id) && (!needle || o.name.toLowerCase().includes(needle)));
  const visible = rest.slice(0, SHOW_MAX);
  const hidden = rest.length - visible.length;
  const searchable = options.length > SEARCH_FROM;

  return (
    <div style={{ padding: "14px 0", borderTop: `1px solid ${c.line}` }}>
      <RungHead rung={rung} count={selected.length} />

      {options.length === 0 ? (
        <div style={{ fontSize: 12.5, color: c.hint, marginTop: 9 }}>{empty}</div>
      ) : (
        <>
          {searchable && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder ?? "Search…"}
                style={{
                  flex: "0 1 260px", padding: "7px 10px", borderRadius: 7, fontSize: 12.5,
                  border: `1px solid ${c.line}`, background: c.panel2, color: c.ink,
                }}
              />
              <span style={{ fontSize: 11.5, color: c.hint }}>
                {needle ? `${rest.length} of ${options.length - chosen.length} match` : `${options.length} available`}
              </span>
            </div>
          )}

          {chosen.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
              {chosen.map((o) => chip(o, true))}
            </div>
          )}

          {visible.length > 0 && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 7,
              marginTop: chosen.length > 0 ? 8 : 10,
              paddingTop: chosen.length > 0 ? 8 : 0,
              borderTop: chosen.length > 0 ? `1px dashed ${c.line}` : undefined,
            }}>
              {visible.map((o) => chip(o, false))}
            </div>
          )}

          {hidden > 0 && (
            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 8 }}>
              +{hidden} more — type a name to narrow the list.
            </div>
          )}

          {needle && rest.length === 0 && (
            <div style={{ fontSize: 12.5, color: c.hint, marginTop: 10 }}>
              Nothing matches “{q.trim()}”.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Create/edit a project.
 *
 * Deliberately in two halves: what the project IS (name, dates, budget), and
 * where its hours COME FROM (any mix of sites, people and shifts). Linking
 * lives here, on the project, rather than on the roster -- being on a project
 * is a standing fact, not a dated exception, and the roster's own section is
 * for exceptions.
 */
export default function ProjectForm({
  project,
  parentId = null,
  accountId = null,
}: {
  project?: WfmProject;
  /** Set when creating a sub-project from a project's "Create sub-project"
   *  button — it preselects the row in the "Sits under" picker. */
  parentId?: string | null;
  /** Set when arriving from an account's "New project" — preselects it. */
  accountId?: string | null;
}) {
  const router = useRouter();
  const editing = !!project;
  // A sub-project is the same form as a project, plus where it sits. Which
  // parent you pick IS the level (owner decision 2026-09-06): a Level field
  // you set separately could contradict the parent, so the level is shown as
  // a consequence rather than asked for.
  const isSub = editing ? !!project?.parent_id : !!parentId;

  const [name, setName] = useState(project?.name ?? "");
  const [code, setCode] = useState(project?.code ?? "");
  const [status, setStatus] = useState<WfmProjectStatus>(project?.status ?? "active");
  const [startDate, setStartDate] = useState(project?.start_date ?? "");
  const [endDate, setEndDate] = useState(project?.end_date ?? "");
  const [budgetHours, setBudgetHours] = useState(project?.budget_hours != null ? String(project.budget_hours) : "");
  const [billRate, setBillRate] = useState(project?.bill_rate != null ? String(project.bill_rate) : "");
  // Where this sits. Null means it IS a project (Level 0).
  const [parentSel, setParentSel] = useState<string>(parentId ?? project?.parent_id ?? "");
  const [tree, setTree] = useState<{ id: string; name: string; ref: string | null; parent_id: string | null }[]>([]);
  // The customer this project is for. Optional -- a project can stand alone
  // -- but billing needs one (WFM_PROJECT_COSTING.md §11).
  const [accountSel, setAccountSel] = useState<string>(project?.account_id ?? accountId ?? "");
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [accountQ, setAccountQ] = useState("");

  const [siteIds, setSiteIds] = useState<string[]>(project?.site_ids ?? []);
  const [employeeIds, setEmployeeIds] = useState<string[]>(project?.employee_ids ?? []);
  const [shiftIds, setShiftIds] = useState<string[]>(project?.shift_ids ?? []);

  const [sites, setSites] = useState<Option[]>([]);
  const [employees, setEmployees] = useState<Option[]>([]);
  const [shifts, setShifts] = useState<Option[]>([]);

  const [showMore, setShowMore] = useState(
    !!(project?.code || project?.start_date || project?.end_date || project?.budget_hours || project?.bill_rate)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Who a supervisor has actually rostered onto this project. Read-only --
  // the roster is where it is set; this shows what rung 1 currently holds, so
  // the section is a rule WITH its data rather than a rule on its own.
  const [rostered, setRostered] = useState<{ id: string; date: string; who: string }[] | null>(null);

  useEffect(() => {
    const j = async (url: string) => {
      const r = await fetch(url).catch(() => null);
      if (!r || !r.ok) return [];
      const d = await r.json().catch(() => []);
      return Array.isArray(d) ? d : (d?.sites ?? d?.employees ?? d?.shifts ?? []);
    };
    (async () => {
      const [s, e, sh, pr, ac] = await Promise.all([
        j("/api/wfm/sites"),
        j("/api/wfm/employees"),
        j("/api/wfm/shifts"),
        j("/api/wfm/projects"),
        j("/api/accounts"),
      ]);
      setAccounts(ac.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      setTree(pr.map((x: { id: string; name: string; ref: string | null; parent_id: string | null }) =>
        ({ id: x.id, name: x.name, ref: x.ref, parent_id: x.parent_id })));
      setSites(s.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      setEmployees(
        e
          .filter((x: { status?: string }) => x.status !== "inactive")
          .map((x: { id: string; first_name: string; last_name: string; employee_code: string | null }) => ({
            id: x.id,
            name: [x.first_name, x.last_name].filter(Boolean).join(" ") + (x.employee_code ? ` (${x.employee_code})` : ""),
          }))
      );
      setShifts(
        sh
          .filter((x: { active?: boolean }) => x.active !== false)
          .map((x: { id: string; name: string; start_time?: string; end_time?: string }) => ({
            id: x.id,
            name: x.start_time ? `${x.name} ${x.start_time.slice(0, 5)}–${(x.end_time ?? "").slice(0, 5)}` : x.name,
          }))
      );
    })();
  }, []);

  useEffect(() => {
    if (!project?.id) { setRostered([]); return; }
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    fetch(`/api/wfm/roster?from=${from}&to=${to}&project_id=${project.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown) => {
        const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
        setRostered(
          list.map((r) => {
            const raw = r.employees as
              | { first_name?: string; last_name?: string }
              | { first_name?: string; last_name?: string }[]
              | null
              | undefined;
            const e = Array.isArray(raw) ? raw[0] : raw;
            return {
              id: r.id as string,
              date: r.date as string,
              who: [e?.first_name, e?.last_name].filter(Boolean).join(" ") || "Someone",
            };
          })
        );
      })
      .catch(() => setRostered([]));
  }, [project?.id]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const linkCount = siteIds.length + employeeIds.length + shiftIds.length;

  /** What the collapsed linking section says it holds, so the common case --
   *  checking rather than changing -- needs no click. */
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const linkSummary =
    [
      employeeIds.length ? plural(employeeIds.length, "person", "people") : null,
      shiftIds.length ? plural(shiftIds.length, "shift", "shifts") : null,
      siteIds.length ? plural(siteIds.length, "site", "sites") : null,
    ].filter(Boolean).join(" · ") || "Nothing linked — hours come from the roster only";

  // ── Where this sits, and therefore what level it is ───────────────────────
  const nodes = new Map(tree.map((t) => [t.id, { id: t.id, parent_id: t.parent_id }]));
  const depthFor = (id: string) => depthOf(nodes, id) ?? 0;

  /** Everything that could hold this one: any project or sub-project with room
   *  beneath it. When editing, its own subtree is excluded — moving something
   *  inside itself is the loop the API rejects anyway, so it is never offered. */
  const banned = new Set(editing && project ? [project.id, ...descendantsOf(tree, project.id)] : []);
  const parentOptions = tree
    .filter((t) => !banned.has(t.id) && canNest(depthFor(t.id)))
    .map((t) => ({ ...t, depth: depthFor(t.id) }))
    .sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));

  const level = parentSel ? depthFor(parentSel) + 1 : 0;

  // Its own level must leave room for a child.
  const myDepth = editing && project ? depthFor(project.id) : level;
  const canAddSub = canNest(myDepth) && (editing || !isSub);

  async function addSubProject() {
    if (editing && project) {
      router.push(`${ROUTES.wfmProjectNew}?parent=${project.id}`);
      return;
    }
    const saved = await persist();
    if (saved?.id) router.push(`${ROUTES.wfmProjectNew}?parent=${saved.id}`);
  }

  /** Create or update, returning the saved row. Separate from save() because
   *  "Save & add sub-project" needs the new id before it can navigate. */
  async function persist(): Promise<{ id: string } | null> {
    setError("");
    if (!name.trim()) { setError("Give the project a name."); return null; }
    setSaving(true);

    const body = {
      name: name.trim(),
      code: code.trim() || null,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
      budget_hours: budgetHours.trim() === "" ? null : Number(budgetHours),
      bill_rate: billRate.trim() === "" ? null : Number(billRate),
      account_id: accountSel || null,
      ...(isSub ? { parent_id: parentSel || null } : {}),
      site_ids: siteIds,
      employee_ids: employeeIds,
      shift_ids: shiftIds,
    };

    const res = await fetch(
      editing ? `/api/wfm/projects/${project!.id}` : "/api/wfm/projects",
      { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    ).catch(() => null);

    setSaving(false);
    if (!res) { setError("Network error — nothing was saved."); return null; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error ?? "Could not save the project."); return null; }
    return json as { id: string };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const saved = await persist();
    if (!saved) return;
    // After adding a sub-project, go back to the one it sits under, not the
    // top-level list -- a project usually gets several in one sitting.
    router.push(
      editing
        ? ROUTES.wfmProject(project!.id)
        : parentSel
          ? ROUTES.wfmProject(parentSel)
          : ROUTES.wfmProjects
    );
    router.refresh();
  }

  return (
    <form onSubmit={save} className="sticky-actions-page" style={{ maxWidth: 760 }}>
      <div style={{ ...cardStyle, padding: 20 }}>
        {isSub && (
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Sits under</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <select
                style={{ ...field, maxWidth: 420 }}
                value={parentSel}
                onChange={(e) => setParentSel(e.target.value)}
              >
                {parentOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {"— ".repeat(o.depth)}{o.name}{o.ref ? ` (${o.ref})` : ""}
                  </option>
                ))}
              </select>
              <span style={{
                flexShrink: 0, fontSize: 12, fontWeight: 700, color: c.accent,
                background: c.accentbg, border: `1px solid ${c.accent}40`,
                borderRadius: 6, padding: "6px 10px", whiteSpace: "nowrap",
              }}>
                Level {level}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 5, lineHeight: 1.5 }}>
              The project is Level 0. Whatever you pick here decides the level — pick the
              project for Level 1, or a Level 1 sub-project to go a step deeper. Maximum
              is Level {MAX_LEVEL}, so anything already that deep isn&apos;t listed.
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={label}>{isSub ? "Sub-project name" : "Project name"}</label>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <input
              style={{ ...field, flex: "1 1 260px", width: "auto" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isSub ? "e.g. Structural works" : "e.g. Tower A — lift overhaul"}
              autoFocus
            />
            {/* A sub-project needs a saved parent to point at, so on an unsaved
                project this saves first and then opens the sub-project form. */}
            {canAddSub && (
              <button
                type="button"
                onClick={addSubProject}
                disabled={saving}
                style={{
                  flexShrink: 0, padding: "9px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                  border: `1px solid ${c.accent}`, background: c.accentbg, color: c.accent,
                  cursor: saving ? "default" : "pointer",
                }}
              >
                {editing ? "+ Create sub-project" : "Save & add sub-project"}
              </button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 5 }}>
            The only thing needed to create it. Its ID is assigned for you.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <div>
            <label style={label}>Status</label>
            <select style={field} value={status} onChange={(e) => setStatus(e.target.value as WfmProjectStatus)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 5 }}>
              {STATUSES.find((s) => s.value === status)?.hint}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={label}>For account (optional)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {accounts.length > SEARCH_FROM && (
              <input
                type="search"
                value={accountQ}
                onChange={(e) => setAccountQ(e.target.value)}
                placeholder="Find an account…"
                style={{ ...field, flex: "0 1 220px", width: "auto" }}
              />
            )}
            <select
              style={{ ...field, flex: "1 1 240px", width: "auto" }}
              value={accountSel}
              onChange={(e) => setAccountSel(e.target.value)}
            >
              <option value="">— none, stands alone —</option>
              {accounts
                .filter((a) => a.id === accountSel || !accountQ.trim() || a.name.toLowerCase().includes(accountQ.trim().toLowerCase()))
                .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 5 }}>
            The customer this work is for. Needed to bill its hours; otherwise optional.
          </div>
        </div>

        {!showMore ? (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            style={{
              marginTop: 14, fontSize: 12.5, fontWeight: 600, color: c.accent,
              background: "none", border: "none", cursor: "pointer", padding: 0,
            }}
          >
            + Add dates, budget or a contract number
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginTop: 16 }}>
            <div>
              <label style={label}>Runs from</label>
              <input type="date" style={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label style={label}>Until</label>
              <input type="date" style={field} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div>
              <label style={label}>Budget hours</label>
              <input type="number" min="0" step="0.5" style={field} value={budgetHours} onChange={(e) => setBudgetHours(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label style={label}>Contract / PO number</label>
              <input style={field} value={code} onChange={(e) => setCode(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label style={label}>Bill rate per hour</label>
              <input type="number" min="0" step="0.01" style={field} value={billRate} onChange={(e) => setBillRate(e.target.value)} placeholder="uses workspace rate" />
            </div>
            <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: c.hint }}>
              Only punches inside the dates count toward this project. The budget is what the
              percentage on the project page is measured against.
            </div>
          </div>
        )}
      </div>

      {/* Collapsed by default: four pickers of chips is most of this form's
          height, and creating a project rarely needs any of them -- the header
          says what is linked, so it only opens when that is what you came for. */}
      <div style={{ marginTop: 16 }}>
      <SettingsSection id="wfm-project-links" title="Where its hours come from" summary={linkSummary}>
        <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 4, lineHeight: 1.55 }}>
          Link this project to whatever fits — any mix, or none at all. Nobody has to pick a
          project when they punch; it&apos;s worked out from these.
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ padding: "14px 0", borderTop: `1px solid ${c.line}` }}>
            <RungHead rung={RUNGS.roster} count={rostered?.length ?? 0} />
            {rostered === null ? (
              <div style={{ fontSize: 12.5, color: c.hint, marginTop: 9 }}>Loading…</div>
            ) : rostered.length === 0 ? (
              <div style={{ fontSize: 12.5, color: c.hint, marginTop: 9 }}>
                Nobody is rostered onto this project in the next 90 days.{" "}
                <Link href={ROUTES.wfmRoster} style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}>
                  Assign on the roster →
                </Link>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                  {rostered.slice(0, 24).map((r) => (
                    <span key={r.id} style={{
                      fontSize: 12.5, color: RUNGS.roster.tone.fg, background: RUNGS.roster.tone.bg,
                      border: `1px solid ${RUNGS.roster.tone.base}60`, borderRadius: 6, padding: "5px 11px",
                    }}>
                      {r.who} · {fmtDay(r.date)}
                    </span>
                  ))}
                  {rostered.length > 24 && (
                    <span style={{ fontSize: 12.5, color: c.hint, alignSelf: "center" }}>
                      +{rostered.length - 24} more
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: c.hint, marginTop: 8 }}>
                  Set on the{" "}
                  <Link href={ROUTES.wfmRoster} style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}>
                    roster
                  </Link>
                  , not here — it is a dated exception, and it beats everything below.
                </div>
              </>
            )}
          </div>

          <Picker rung={RUNGS.people} options={employees} selected={employeeIds}
            onToggle={toggle(setEmployeeIds)} empty="No employees yet."
            searchPlaceholder="Search name or code…" />
          <Picker rung={RUNGS.shifts} options={shifts} selected={shiftIds}
            onToggle={toggle(setShiftIds)} empty="No shifts configured yet."
            searchPlaceholder="Search shifts…" />
          <Picker rung={RUNGS.sites} options={sites} selected={siteIds}
            onToggle={toggle(setSiteIds)} empty="No sites configured yet."
            searchPlaceholder="Search sites…" />
        </div>

        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 14, lineHeight: 1.5 }}>
          First match wins, top to bottom. If a step finds two projects at once, the hours are
          left <strong style={{ color: statusInk.warn }}>unassigned</strong> rather than
          guessed — you&apos;ll see them on the Projects screen and can settle it on the roster.
        </div>

        {linkCount === 0 && (
          <div style={{
            marginTop: 14, padding: "10px 12px", borderRadius: 8,
            background: c.panel2, fontSize: 12.5, color: c.muted, lineHeight: 1.5,
          }}>
            Nothing linked yet, which is fine — this project just won&apos;t pick up hours on its own.
            You can still put people on it day by day from the roster.
          </div>
        )}
      </SettingsSection>
      </div>

      {error && <div style={{ marginTop: 14, fontSize: 12.5, color: statusInk.bad }}>{error}</div>}

      {/* Follows the page. This form runs to two screens once the linking
          section is open, and a submit parked under all of it means scrolling
          past everything to commit the field you just filled in. */}
      <div
        className="sticky-actions"
        style={{
          marginTop: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
          padding: "12px 14px",
          background: "var(--card-bg)", border: "1px solid var(--line)",
          borderRadius: "var(--card-radius)", boxShadow: "var(--card-shadow)",
        }}
      >
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: c.accent, color: "#fff", border: "none",
            cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
          }}
        >
          {saving
            ? "Saving…"
            : editing
              ? "Save changes"
              : isSub
                ? `Create Level ${level} sub-project`
                : "Create project"}
        </button>
        <button
          type="button"
          onClick={() => (parentId && !editing ? router.push(ROUTES.wfmProject(parentId)) : router.back())}
          style={{
            padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer",
          }}
        >
          Cancel
        </button>
        {isSub && !editing && (
          <span style={{ fontSize: 11.5, color: c.hint }}>
            Goes under <strong style={{ color: c.muted }}>{parentOptions.find((o) => o.id === parentSel)?.name ?? "—"}</strong>
          </span>
        )}
      </div>
    </form>
  );
}
