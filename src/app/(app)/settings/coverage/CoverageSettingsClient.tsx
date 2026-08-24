"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { useFeel } from "@/components/FeelProvider";
import {
  SEGMENT_FIELDS, OPERATOR_LABEL, getSegmentField,
  type SegmentFilter, type SegmentFieldDef,
} from "@/lib/marketingSegmentation";

type Member = { user_id: string; email: string | null; name: string | null };
type Team = { id: string; name: string; lead_user_id: string | null; team_members: { user_id: string }[] };
type Segment = { id: string; code: string; name: string; filters: SegmentFilter[]; match: "all" | "any"; account_ids: string[] };
type CoverageRole = "owner" | "overlay" | "service";
type Coverage = {
  id: string; segment_id: string; team_id: string; role: CoverageRole; priority: number;
  erp_endpoint_id: string | null; effective_from: string; effective_to: string | null;
  segments: { code: string; name: string } | null; teams: { name: string } | null;
};
type Endpoint = { id: string; name: string; webhook_url: string };
type AccountLite = { id: string; name: string };

const TAB_STYLE = (active: boolean): React.CSSProperties => ({
  padding: "8px 16px", borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
  background: active ? c.accent : "transparent", color: active ? "#fff" : c.ink,
  border: `1px solid ${active ? c.accent : c.line}`,
});
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};
const inp: React.CSSProperties = {
  boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 10px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
};
const ROLE_LABEL: Record<CoverageRole, string> = { owner: "Owner", overlay: "Overlay", service: "Service" };
const ROLE_TONE: Record<CoverageRole, string> = { owner: "#1d4ed8", overlay: "#7c3aed", service: "#0d9488" };

function Pill({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 20, color: tone, background: `${tone}18`, border: `1px solid ${tone}40` }}>
      {children}
    </span>
  );
}

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json as T;
}

export default function CoverageSettingsClient() {
  const [tab, setTab] = useState<"teams" | "segments" | "coverage">("teams");
  const [teams, setTeams] = useState<Team[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [coverages, setCoverages] = useState<Coverage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const [teamRows, segmentRows, coverageRows, teamResp, pushCfg, accountRows] = await Promise.all([
        api<Team[]>("/api/settings/coverage/teams"),
        api<Segment[]>("/api/settings/coverage/segments"),
        api<Coverage[]>("/api/settings/coverage/assignments"),
        api<{ members?: Member[] }>("/api/settings/team"),
        api<{ endpoints?: Endpoint[] }>("/api/settings/integration-push"),
        api<AccountLite[]>("/api/accounts"),
      ]);
      setTeams(Array.isArray(teamRows) ? teamRows.map((t) => ({ ...t, team_members: Array.isArray(t.team_members) ? t.team_members : [] })) : []);
      setSegments(Array.isArray(segmentRows) ? segmentRows : []);
      setCoverages(Array.isArray(coverageRows) ? coverageRows : []);
      setMembers(teamResp.members ?? []);
      setEndpoints(pushCfg.endpoints ?? []);
      setAccounts(Array.isArray(accountRows) ? accountRows : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  const memberLabel = (userId: string | null) => {
    if (!userId) return "—";
    const m = members.find((x) => x.user_id === userId);
    return m?.name || m?.email || userId.slice(0, 8);
  };
  const teamLabel = (teamId: string) => teams.find((t) => t.id === teamId)?.name ?? teamId.slice(0, 8);
  const segmentLabel = (segmentId: string) => {
    const s = segments.find((x) => x.id === segmentId);
    return s ? `${s.code} — ${s.name}` : segmentId.slice(0, 8);
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: c.hint }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1040 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={TAB_STYLE(tab === "teams")} onClick={() => setTab("teams")}>Teams</div>
        <div style={TAB_STYLE(tab === "segments")} onClick={() => setTab("segments")}>Segments</div>
        <div style={TAB_STYLE(tab === "coverage")} onClick={() => setTab("coverage")}>Coverage</div>
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}

      {tab === "teams" && <TeamsTab teams={teams} members={members} memberLabel={memberLabel} onChanged={reload} />}
      {tab === "segments" && <SegmentsTab segments={segments} accounts={accounts} onChanged={reload} />}
      {tab === "coverage" && (
        <CoverageTab
          coverages={coverages} segments={segments} teams={teams} endpoints={endpoints}
          teamLabel={teamLabel} segmentLabel={segmentLabel} onChanged={reload}
          onEndpointsChanged={(eps) => setEndpoints(eps)}
        />
      )}
    </div>
  );
}

// ── Teams ────────────────────────────────────────────────────────────────

function TeamsTab({ teams, members, memberLabel, onChanged }: {
  teams: Team[]; members: Member[]; memberLabel: (id: string | null) => string; onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [lead, setLead] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { confirm } = useFeel();

  function startEdit(t: Team) {
    setEditingId(t.id);
    setName(t.name);
    setLead(t.lead_user_id ?? "");
    setMemberIds(new Set(t.team_members.map((m) => m.user_id)));
  }
  function resetForm() {
    setEditingId(null); setName(""); setLead(""); setMemberIds(new Set());
  }

  async function save() {
    if (!name.trim()) { setErr("Team name is required."); return; }
    setSaving(true); setErr("");
    try {
      const payload = { name, lead_user_id: lead || null, member_user_ids: [...memberIds] };
      if (editingId) {
        await api(`/api/settings/coverage/teams/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/settings/coverage/teams", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: "Delete this team?", body: "Any coverage wired to it goes with it.", tone: "danger" }))) return;
    await api(`/api/settings/coverage/teams/${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section style={cardStyle}>
        <div style={{ ...lbl, marginBottom: 10 }}>{editingId ? "Edit team" : "Add a team"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={lbl}>Name</label>
            <input style={{ ...inp, width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. South Pod" />
          </div>
          <div>
            <label style={lbl}>Lead</label>
            <select style={{ ...inp, width: "100%" }} value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">— none —</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>)}
            </select>
          </div>
        </div>
        <label style={lbl}>Members</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {members.map((m) => (
            <label key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: c.ink, border: `1px solid ${c.line}`, borderRadius: 20, padding: "4px 10px", cursor: "pointer" }}>
              <input
                type="checkbox" checked={memberIds.has(m.user_id)}
                onChange={(e) => setMemberIds((prev) => { const next = new Set(prev); if (e.target.checked) next.add(m.user_id); else next.delete(m.user_id); return next; })}
              />
              {m.name || m.email}
            </label>
          ))}
        </div>
        {err && <div style={{ fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Add team"}
          </button>
          {editingId && <button onClick={resetForm} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${c.line}`, background: "none", color: c.ink, fontSize: 13, cursor: "pointer" }}>Cancel</button>}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ ...lbl, marginBottom: 10 }}>Teams ({teams.length})</div>
        {teams.length === 0 ? (
          <div style={{ fontSize: 13, color: c.hint, padding: "16px 0" }}>No teams yet — who sells together?</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {teams.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${c.line}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: c.hint }}>
                    Lead: {memberLabel(t.lead_user_id)} · {t.team_members.length} member{t.team_members.length === 1 ? "" : "s"}
                  </div>
                </div>
                <button onClick={() => startEdit(t)} style={{ fontSize: 12, background: "none", border: `1px solid ${c.line}`, borderRadius: 6, padding: "5px 10px", color: c.ink, cursor: "pointer" }}>Edit</button>
                <button onClick={() => remove(t.id)} style={{ fontSize: 12, background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer" }}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Segments ─────────────────────────────────────────────────────────────

let nextFilterId = 0;

function SegmentsTab({ segments, accounts, onChanged }: { segments: Segment[]; accounts: AccountLite[]; onChanged: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [filters, setFilters] = useState<SegmentFilter[]>([]);
  const [accountIds, setAccountIds] = useState<Set<string>>(new Set());
  const [accountQuery, setAccountQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { confirm } = useFeel();

  const categories = useMemo(() => {
    const map = new Map<string, SegmentFieldDef[]>();
    for (const f of SEGMENT_FIELDS) { const l = map.get(f.category); if (l) l.push(f); else map.set(f.category, [f]); }
    return Array.from(map.entries());
  }, []);

  function addFilter(field: SegmentFieldDef) {
    nextFilterId += 1;
    setFilters((cur) => [...cur, { id: `${field.key}_${nextFilterId}`, field: field.key, operator: field.operators[0], value: field.type === "select" ? (field.options?.[0]?.value ?? "") : "" }]);
  }
  function updateFilter(id: string, patch: Partial<SegmentFilter>) {
    setFilters((cur) => cur.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function removeFilter(id: string) { setFilters((cur) => cur.filter((f) => f.id !== id)); }

  function startEdit(s: Segment) {
    setEditingId(s.id); setCode(s.code); setName(s.name); setMatch(s.match);
    setFilters(s.filters); setAccountIds(new Set(s.account_ids));
  }
  function resetForm() {
    setEditingId(null); setCode(""); setName(""); setMatch("all"); setFilters([]); setAccountIds(new Set());
  }

  async function save() {
    if (!code.trim() || !name.trim()) { setErr("Code and name are required."); return; }
    setSaving(true); setErr("");
    try {
      const payload = { code, name, match, filters, account_ids: [...accountIds] };
      if (editingId) {
        await api(`/api/settings/coverage/segments/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/settings/coverage/segments", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: "Delete this segment?", body: "Any coverage wired to it goes with it.", tone: "danger" }))) return;
    await api(`/api/settings/coverage/segments/${id}`, { method: "DELETE" });
    onChanged();
  }

  const matchingAccounts = accountQuery.trim()
    ? accounts.filter((a) => a.name.toLowerCase().includes(accountQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section style={cardStyle}>
        <div style={{ ...lbl, marginBottom: 10 }}>{editingId ? "Edit segment" : "Add a segment"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={lbl}>Code</label>
            <input style={{ ...inp, width: "100%" }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SOUTH" />
          </div>
          <div>
            <label style={lbl}>Name</label>
            <input style={{ ...inp, width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="South region" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 14, marginBottom: 14 }}>
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10 }}>
            <div style={{ ...lbl, marginBottom: 8 }}>Add a condition</div>
            {categories.map(([category, fields]) => (
              <div key={category} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", marginBottom: 5 }}>{category}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {fields.map((f) => (
                    <div key={f.key} onClick={() => addFilter(f)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel2, cursor: "pointer" }}>
                      {f.label}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={lbl}>Conditions (rule)</div>
              {filters.length > 1 && (
                <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="radio" checked={match === "all"} onChange={() => setMatch("all")} /> Match ALL</label>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="radio" checked={match === "any"} onChange={() => setMatch("any")} /> Match ANY</label>
                </div>
              )}
            </div>
            {filters.length === 0 ? (
              <div style={{ padding: "24px 14px", textAlign: "center", color: c.hint, fontSize: 12.5, border: `1px dashed ${c.line}`, borderRadius: 8 }}>
                Click a field on the left to add a condition — e.g. "State is Karnataka".
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {filters.map((filter, i) => {
                  const field = getSegmentField(filter.field);
                  if (!field) return null;
                  const needsValue = field.type !== "boolean";
                  return (
                    <div key={filter.id} style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      {i > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: c.hint, width: 26 }}>{match === "all" ? "AND" : "OR"}</span>}
                      <span style={{ fontSize: 12, fontWeight: 600, color: c.ink, minWidth: 110 }}>{field.label}</span>
                      <select value={filter.operator} onChange={(e) => updateFilter(filter.id, { operator: e.target.value as SegmentFilter["operator"] })} style={{ ...inp, fontSize: 12, padding: "5px 7px" }}>
                        {field.operators.map((op) => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}
                      </select>
                      {needsValue && (
                        field.type === "select" ? (
                          <select value={filter.value} onChange={(e) => updateFilter(filter.id, { value: e.target.value })} style={{ ...inp, fontSize: 12, padding: "5px 7px" }}>
                            {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={filter.value} onChange={(e) => updateFilter(filter.id, { value: e.target.value })} style={{ ...inp, fontSize: 12, padding: "5px 7px", width: 130 }} />
                        )
                      )}
                      <button onClick={() => removeFilter(filter.id)} style={{ marginLeft: "auto", background: "none", border: "none", color: c.hint, cursor: "pointer", fontSize: 15 }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <label style={lbl}>Named accounts (optional override — always in, regardless of the rule above)</label>
        <input style={{ ...inp, width: "100%", marginBottom: 6 }} value={accountQuery} onChange={(e) => setAccountQuery(e.target.value)} placeholder="Search an account to pin…" />
        {matchingAccounts.length > 0 && (
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
            {matchingAccounts.map((a) => (
              <div key={a.id} onClick={() => { setAccountIds((prev) => new Set(prev).add(a.id)); setAccountQuery(""); }} style={{ padding: "7px 10px", fontSize: 12.5, cursor: "pointer", borderTop: `1px solid ${c.line}` }}>
                {a.name}
              </div>
            ))}
          </div>
        )}
        {accountIds.size > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {[...accountIds].map((id) => {
              const a = accounts.find((x) => x.id === id);
              return (
                <span key={id} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5, border: `1px solid ${c.line}`, borderRadius: 20, padding: "3px 10px" }}>
                  {a?.name ?? id.slice(0, 8)}
                  <span onClick={() => setAccountIds((prev) => { const next = new Set(prev); next.delete(id); return next; })} style={{ cursor: "pointer", color: c.hint }}>×</span>
                </span>
              );
            })}
          </div>
        )}

        {err && <div style={{ fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Add segment"}
          </button>
          {editingId && <button onClick={resetForm} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${c.line}`, background: "none", color: c.ink, fontSize: 13, cursor: "pointer" }}>Cancel</button>}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ ...lbl, marginBottom: 10 }}>Segments ({segments.length})</div>
        {segments.length === 0 ? (
          <div style={{ fontSize: 13, color: c.hint, padding: "16px 0" }}>No segments yet — a segment is a rule, not a label.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {segments.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${c.line}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{s.code} — {s.name}</div>
                  <div style={{ fontSize: 12, color: c.hint }}>
                    {s.filters.length} condition{s.filters.length === 1 ? "" : "s"} ({s.match}) {s.account_ids.length > 0 ? `· ${s.account_ids.length} pinned account${s.account_ids.length === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
                <button onClick={() => startEdit(s)} style={{ fontSize: 12, background: "none", border: `1px solid ${c.line}`, borderRadius: 6, padding: "5px 10px", color: c.ink, cursor: "pointer" }}>Edit</button>
                <button onClick={() => remove(s.id)} style={{ fontSize: 12, background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer" }}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Coverage (the wiring) + ERP endpoints ───────────────────────────────

function CoverageTab({ coverages, segments, teams, endpoints, teamLabel, segmentLabel, onChanged, onEndpointsChanged }: {
  coverages: Coverage[]; segments: Segment[]; teams: Team[]; endpoints: Endpoint[];
  teamLabel: (id: string) => string; segmentLabel: (id: string) => string;
  onChanged: () => void; onEndpointsChanged: (eps: Endpoint[]) => void;
}) {
  const [segmentId, setSegmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<CoverageRole>("owner");
  const [priority, setPriority] = useState(100);
  const [erpEndpointId, setErpEndpointId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { confirm } = useFeel();

  const [endpointName, setEndpointName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [savingEndpoint, setSavingEndpoint] = useState(false);

  async function save() {
    if (!segmentId || !teamId) { setErr("Segment and team are required."); return; }
    setSaving(true); setErr("");
    try {
      await api("/api/settings/coverage/assignments", {
        method: "POST",
        body: JSON.stringify({
          segment_id: segmentId, team_id: teamId, role, priority,
          erp_endpoint_id: erpEndpointId || null,
          effective_from: effectiveFrom, effective_to: effectiveTo || null,
        }),
      });
      setSegmentId(""); setTeamId(""); setRole("owner"); setPriority(100); setErpEndpointId(""); setEffectiveTo("");
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: "Remove this coverage assignment?", tone: "danger" }))) return;
    await api(`/api/settings/coverage/assignments/${id}`, { method: "DELETE" });
    onChanged();
  }

  async function addEndpoint() {
    if (!endpointName.trim() || !endpointUrl.trim()) return;
    setSavingEndpoint(true);
    try {
      const merged = await api<{ endpoints?: Endpoint[] }>("/api/settings/integration-push", {
        method: "PATCH",
        body: JSON.stringify({ endpoints: [...endpoints, { name: endpointName, webhook_url: endpointUrl }] }),
      });
      onEndpointsChanged(merged.endpoints ?? []);
      setEndpointName(""); setEndpointUrl("");
    } catch {
      // surfaced implicitly via the unchanged endpoints list
    } finally {
      setSavingEndpoint(false);
    }
  }

  async function removeEndpoint(id: string) {
    const merged = await api<{ endpoints?: Endpoint[] }>("/api/settings/integration-push", {
      method: "PATCH",
      body: JSON.stringify({ endpoints: endpoints.filter((e) => e.id !== id) }),
    });
    onEndpointsChanged(merged.endpoints ?? []);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section style={cardStyle}>
        <div style={{ ...lbl, marginBottom: 10 }}>Wire a segment to a team</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px 100px", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={lbl}>Segment</label>
            <select style={{ ...inp, width: "100%" }} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              <option value="">— choose —</option>
              {segments.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Team</label>
            <select style={{ ...inp, width: "100%" }} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">— choose —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Role</label>
            <select style={{ ...inp, width: "100%" }} value={role} onChange={(e) => setRole(e.target.value as CoverageRole)}>
              <option value="owner">Owner</option>
              <option value="overlay">Overlay</option>
              <option value="service">Service</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Priority</label>
            <input type="number" style={{ ...inp, width: "100%" }} value={priority} onChange={(e) => setPriority(parseInt(e.target.value, 10) || 100)} />
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 12 }}>
          Priority only matters for OWNER — when two OWNER segments both match one account, the lower number wins. Overlay/service are additive: every match applies.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 140px", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={lbl}>Push this coverage's accounts to</label>
            <select style={{ ...inp, width: "100%" }} value={erpEndpointId} onChange={(e) => setErpEndpointId(e.target.value)}>
              <option value="">Tenant default endpoint</option>
              {endpoints.map((ep) => <option key={ep.id} value={ep.id}>{ep.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Effective from</label>
            <input type="date" style={{ ...inp, width: "100%" }} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Effective to (optional)</label>
            <input type="date" style={{ ...inp, width: "100%" }} value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
          </div>
        </div>

        {err && <div style={{ fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>{err}</div>}
        <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : "Add coverage"}
        </button>
      </section>

      <section style={cardStyle}>
        <div style={{ ...lbl, marginBottom: 10 }}>Coverage ({coverages.length})</div>
        {coverages.length === 0 ? (
          <div style={{ fontSize: 13, color: c.hint, padding: "16px 0" }}>Nothing wired yet — an account matching a segment with no coverage simply has no owner.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {coverages.map((cov) => (
              <div key={cov.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${c.line}` }}>
                <Pill tone={ROLE_TONE[cov.role]}>{ROLE_LABEL[cov.role]}</Pill>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: c.ink }}>{cov.segments ? `${cov.segments.code} — ${cov.segments.name}` : segmentLabel(cov.segment_id)} → {cov.teams?.name ?? teamLabel(cov.team_id)}</div>
                  <div style={{ fontSize: 12, color: c.hint }}>
                    priority {cov.priority} · from {cov.effective_from}{cov.effective_to ? ` to ${cov.effective_to}` : ""}
                    {cov.erp_endpoint_id ? ` · pushes to ${endpoints.find((e) => e.id === cov.erp_endpoint_id)?.name ?? "custom endpoint"}` : ""}
                  </div>
                </div>
                <button onClick={() => remove(cov.id)} style={{ fontSize: 12, background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer" }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={cardStyle}>
        <div style={{ ...lbl, marginBottom: 4 }}>ERP endpoints</div>
        <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 12 }}>Named push targets a coverage row can route to. The tenant's single default endpoint (Settings → General → Developer) is used when a coverage doesn't specify one.</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input style={{ ...inp, flex: 1 }} placeholder="Endpoint name (e.g. SAP South)" value={endpointName} onChange={(e) => setEndpointName(e.target.value)} />
          <input style={{ ...inp, flex: 2 }} placeholder="https://…" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} />
          <button onClick={addEndpoint} disabled={savingEndpoint} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${c.line}`, background: "none", color: c.ink, fontSize: 13, cursor: "pointer" }}>Add</button>
        </div>
        {endpoints.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {endpoints.map((ep) => (
              <div key={ep.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, color: c.ink }}>{ep.name}</span>
                <span style={{ color: c.hint, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.webhook_url}</span>
                <button onClick={() => removeEndpoint(ep.id)} style={{ background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer", fontSize: 12 }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
