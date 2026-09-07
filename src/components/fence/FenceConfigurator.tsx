"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c, sh } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Pill from "@/components/Pill";
import { computeGeometry, type FenceGateInput, type FenceLayout } from "@/lib/fence/geometry";
import { computeBom, type FenceAccessories, type BomLine } from "@/lib/fence/bom";
import { buildMaterialRequests, matchMaterials, distinctValues, meshGapPx, type FenceCatalogRow } from "@/lib/fence/materialMatch";
import type { FenceSecurityProfileRow } from "@/lib/fence/data";
import Fence3DView from "./Fence3DView";

const POST_KINDS = new Set(["line_post", "straining_post", "corner_post", "terminal_post", "gate_post"]);

const STATUS_LABEL: Record<FenceProjectSnapshot["status"], string> = {
  draft: "Draft",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};
const STATUS_TONE: Record<FenceProjectSnapshot["status"], "amber" | "blue" | "green" | "red"> = {
  draft: "amber",
  quoted: "blue",
  won: "green",
  lost: "red",
};

const BOM_LABEL: Record<BomLine["kind"], string> = {
  tension_band: "Tension bands",
  brace_band: "Brace bands",
  rail_end: "Rail ends",
  carriage_bolt_set: "Carriage bolt sets",
  truss_rod_set: "Truss rod sets",
  tension_wire: "Tension wire",
  tie_wire: "Tie wire",
  barbed_wire: "Barbed wire",
};

// Not a fixed 3-tier enum -- every field here is meant to be renamed, tuned
// or deleted (docs/fence-configurator-architecture.md owner decision #2).
// Shape mirrors fence_security_profiles; "custom*" ids are local-only
// profiles added in this session for a quick estimate -- Save is disabled
// while one of those is active (profiles are a shared, tenant-level
// preset, not a per-project snapshot: saving stores WHICH profile was
// picked, not a copy of its numbers, so an ad hoc one has nowhere to go
// without a Settings screen for authoring real profiles, which doesn't
// exist yet -- an explicit, documented v1 gap, not silent data loss).
type Profile = { id: string; label: string; blurb: string; spacing: number; pipe: string; embedment: number };

const FALLBACK_PIPE_CLASSES = ["Commercial pipe", "Schedule 40", "SS20", "SS40"];
const FALLBACK_PROFILES: Profile[] = [
  { id: "yard", label: "General yard & storage", blurb: "Fenced boundary, low foot traffic", spacing: 3, pipe: "Schedule 40", embedment: 0.9 },
];

function toProfile(row: FenceSecurityProfileRow): Profile {
  return { id: row.id, label: row.label, blurb: row.blurb ?? "", spacing: row.post_spacing_m, pipe: row.pipe_class, embedment: row.embedment_m };
}

let gateSeq = 0;
function newGate(type: FenceGateInput["type"] = "double_swing", width_m = 3): FenceGateInput & { id: number } {
  gateSeq += 1;
  return { id: gateSeq, type, width_m };
}

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface FenceProjectSnapshot {
  id: string;
  ref: string | null;
  name: string;
  status: "draft" | "quoted" | "won" | "lost";
  standardQuoteId: string | null;
  accountId: string | null;
  contactId: string | null;
  securityProfileId: string | null;
  layout: FenceLayout;
  totalLength: number;
  fabricHeight: number;
  meshSpec: string | null;
  coating: string;
  gates: { type: FenceGateInput["type"]; width_m: number }[];
  strainingSpacing: number;
  accessories: FenceAccessories;
}

/** What AI-drafted intake (§14b) can propose before anything is saved --
 *  a subset of FenceProjectSnapshot, since a draft has no id/ref/status
 *  yet. Only fields the extraction actually found are set; everything
 *  else falls back to the same defaults a blank project would use. */
export interface FenceDraftValues {
  name?: string | null;
  layout?: FenceLayout | null;
  totalLength?: number | null;
  securityProfileId?: string | null;
  gates?: { type: FenceGateInput["type"]; width_m: number }[];
}

export default function FenceConfigurator({
  profiles: initialProfiles,
  catalog,
  accounts,
  contacts,
  project,
  draft,
}: {
  profiles: FenceSecurityProfileRow[];
  catalog: FenceCatalogRow[];
  accounts: { id: string; name: string }[];
  contacts: { id: string; name: string; account_id: string }[];
  /** Omitted in create mode; a saved snapshot puts the screen in edit mode. */
  project?: FenceProjectSnapshot;
  /** Create mode only -- seeds initial values from AI-drafted intake. */
  draft?: FenceDraftValues;
}) {
  const router = useRouter();
  const isEdit = !!project;

  const [name, setName] = useState(project?.name ?? draft?.name ?? "New fence project");
  const [accountId, setAccountId] = useState(project?.accountId ?? "");
  const [contactId, setContactId] = useState(project?.contactId ?? "");

  const [profiles, setProfiles] = useState<Profile[]>(() => (initialProfiles.length > 0 ? initialProfiles.map(toProfile) : FALLBACK_PROFILES));
  const [activeId, setActiveId] = useState(() => {
    const wanted = project?.securityProfileId ?? draft?.securityProfileId;
    if (wanted && profiles.some((p) => p.id === wanted)) return wanted;
    return profiles[0].id;
  });
  const pipeClasses = useMemo(() => {
    const fromCatalog = distinctValues(catalog, ["line_post", "straining_post", "corner_post", "terminal_post", "gate_post"], "pipe_class");
    return fromCatalog.length > 0 ? fromCatalog : FALLBACK_PIPE_CLASSES;
  }, [catalog]);
  const meshSpecs = useMemo(() => distinctValues(catalog, ["fabric"], "mesh_spec"), [catalog]);
  const [meshSpec, setMeshSpec] = useState(project?.meshSpec ?? meshSpecs[0] ?? "");
  const [layout, setLayout] = useState<FenceLayout>(project?.layout ?? draft?.layout ?? "closed_perimeter");
  const [totalLength, setTotalLength] = useState(project?.totalLength ?? draft?.totalLength ?? 500);
  const [strainingSpacing] = useState(project?.strainingSpacing ?? 100);
  const [fabricHeight, setFabricHeight] = useState(project?.fabricHeight ?? 2);
  const [gates, setGates] = useState<(FenceGateInput & { id: number })[]>(() => {
    if (project) return project.gates.map((g) => newGate(g.type, g.width_m));
    if (draft?.gates && draft.gates.length > 0) return draft.gates.map((g) => newGate(g.type, g.width_m));
    return [newGate("double_swing", 6), newGate("double_swing", 4)];
  });
  const [accessories, setAccessories] = useState<FenceAccessories>(
    project?.accessories ?? { truss_rods: true, tension_wire: true, tie_wire: true, barbed_wire: false }
  );
  const [view, setView] = useState<"plan" | "3d">("plan");
  const [coating] = useState(project?.coating ?? "PVC coated"); // fixed for now -- a real coating picker is a future materials-UI phase

  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Tracks whether anything has changed since the last save (initialized to
  // the as-loaded state, updated to the just-saved state on every successful
  // save). Used only to warn that an already-quoted project has drifted from
  // its quote -- there's no re-quote action yet (owner decision: keep the
  // quote immutable once issued, don't invent a revision flow under time
  // pressure), so this is informational, not a blocker.
  const currentConfigSnapshot = JSON.stringify({
    name, accountId, contactId, activeId, layout, totalLength, fabricHeight, meshSpec,
    gates: gates.map((g) => ({ type: g.type, width_m: g.width_m })), accessories,
  });
  const lastSavedSnapshotRef = useRef(currentConfigSnapshot);
  const isDirtySinceQuote = isEdit && !!project?.standardQuoteId && currentConfigSnapshot !== lastSavedSnapshotRef.current;

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const activeIsRealProfile = initialProfiles.some((p) => p.id === activeId);
  // Previously any spacing/pipe/embedment tweak was a live estimate only --
  // switching profiles or leaving the page silently discarded it, with no
  // way to actually change the tenant's real preset short of another SQL
  // script. Comparing against the profile's own as-loaded values lets the
  // sidebar offer to persist a real tuning, without a full profile-authoring
  // Settings screen.
  const originalActiveProfile = initialProfiles.find((p) => p.id === activeId);
  const profileTuned =
    activeIsRealProfile && !!originalActiveProfile &&
    (active.spacing !== originalActiveProfile.post_spacing_m ||
      active.pipe !== originalActiveProfile.pipe_class ||
      active.embedment !== originalActiveProfile.embedment_m ||
      active.label !== originalActiveProfile.label ||
      active.blurb !== (originalActiveProfile.blurb ?? ""));
  const [savingProfile, setSavingProfile] = useState(false);

  async function handleSaveProfile() {
    setSavingProfile(true);
    setError("");
    const res = await fetch(`/api/fence-security-profiles/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: active.label, blurb: active.blurb, post_spacing_m: active.spacing, embedment_m: active.embedment, pipe_class: active.pipe }),
    });
    const json = await res.json().catch(() => ({}));
    setSavingProfile(false);
    if (!res.ok) { setError(json.error ?? "Could not save the profile"); return; }
    router.refresh();
  }

  const geometry = useMemo(
    () =>
      computeGeometry({
        layout,
        total_length_m: totalLength,
        post_spacing_m: active.spacing,
        embedment_m: active.embedment,
        straining_spacing_m: strainingSpacing,
        gates,
        fabric_height_m: fabricHeight,
      }),
    [layout, totalLength, active.spacing, active.embedment, strainingSpacing, gates, fabricHeight]
  );

  const bom = useMemo(
    () => computeBom({ geometry, fabric_height_m: fabricHeight, total_length_m: totalLength, accessories }),
    [geometry, fabricHeight, totalLength, accessories]
  );

  // Re-matched against the tenant's own catalog on every change, client-side
  // -- the catalog itself was fetched once at page load, so this stays a
  // pure re-computation, same "one frame" feel as geometry/BOM (UX bar
  // §1b), instead of a round trip per slider drag.
  const resolved = useMemo(
    () => matchMaterials(buildMaterialRequests(geometry, bom), catalog, { pipe_class: active.pipe, mesh_spec: meshSpec, coating }),
    [geometry, bom, catalog, active.pipe, meshSpec, coating]
  );
  const unresolvedCount = resolved.filter((r) => !r.product_id).length;
  const materialsCost = resolved.reduce((sum, r) => sum + (r.list_price ?? 0) * r.qty, 0);
  const quantitiesByCategory = useMemo(() => {
    const groups: { label: string; lines: typeof resolved }[] = [
      { label: "Posts", lines: [] },
      { label: "Fabric", lines: [] },
      { label: "Hardware", lines: [] },
    ];
    for (const r of resolved) {
      if (POST_KINDS.has(r.fence_kind)) groups[0].lines.push(r);
      else if (r.fence_kind === "fabric") groups[1].lines.push(r);
      else groups[2].lines.push(r);
    }
    return groups.filter((g) => g.lines.length > 0);
  }, [resolved]);

  const [quantitiesOpen, setQuantitiesOpen] = useState(false);
  const [accountSectionOpen, setAccountSectionOpen] = useState(!project?.accountId);
  const [profileSectionOpen, setProfileSectionOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  // Same layout/length/gates/fabric/mesh/coating/accessories, priced against
  // EVERY profile's own numbers -- side-by-side, non-destructive comparison
  // (each profile keeps its own tuned spacing/pipe/embedment in `profiles`
  // state regardless of which one is active, so switching to compare never
  // loses another profile's edits -- concept differentiator #2, per
  // docs/fence-configurator-architecture.md §0).
  const comparisons = useMemo(
    () =>
      profiles.map((p) => {
        const geo = computeGeometry({
          layout, total_length_m: totalLength, post_spacing_m: p.spacing, embedment_m: p.embedment,
          straining_spacing_m: strainingSpacing, gates, fabric_height_m: fabricHeight,
        });
        const b = computeBom({ geometry: geo, fabric_height_m: fabricHeight, total_length_m: totalLength, accessories });
        const res = matchMaterials(buildMaterialRequests(geo, b), catalog, { pipe_class: p.pipe, mesh_spec: meshSpec, coating });
        return {
          profile: p,
          totalPosts: geo.total_posts,
          cost: res.reduce((sum, r) => sum + (r.list_price ?? 0) * r.qty, 0),
          unresolvedCount: res.filter((r) => !r.product_id).length,
        };
      }),
    [profiles, layout, totalLength, strainingSpacing, gates, fabricHeight, accessories, catalog, meshSpec, coating]
  );

  function updateActive(patch: Partial<Profile>) {
    setProfiles((ps) => ps.map((p) => (p.id === activeId ? { ...p, ...patch } : p)));
  }
  function addProfile() {
    const id = `custom${Date.now()}`;
    const p: Profile = { id, label: "New profile (estimate only)", blurb: "Not saved -- pick a real profile before saving the project", spacing: active.spacing, pipe: active.pipe, embedment: active.embedment };
    setProfiles((ps) => [...ps, p]);
    setActiveId(id);
  }
  function updateGate(id: number, patch: Partial<FenceGateInput>) {
    setGates((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  async function handleSave() {
    if (!name.trim()) { setError("Name is required"); return; }
    if (!activeIsRealProfile) { setError("Choose one of your tenant's security profiles before saving -- a local estimate profile isn't saved."); return; }
    setError("");
    setSaving(true);
    const body = {
      name: name.trim(),
      account_id: accountId || null,
      contact_id: contactId || null,
      security_profile_id: activeId,
      layout,
      total_length_m: totalLength,
      fabric_height_m: fabricHeight,
      mesh_spec: meshSpec || null,
      coating,
      custom_data: { straining_spacing_m: strainingSpacing, accessories },
      gates: gates.map((g) => ({ type: g.type, width_m: g.width_m })),
    };
    const res = await fetch(isEdit ? `/api/fence-projects/${project!.id}` : "/api/fence-projects", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json.error ?? "Could not save the project"); return; }
    lastSavedSnapshotRef.current = currentConfigSnapshot;
    if (isEdit) router.refresh();
    else router.push(ROUTES.fenceProject(json.id));
  }

  async function handleConvertToQuote() {
    if (!project) return;
    setError("");
    setConverting(true);
    const res = await fetch(`/api/fence-projects/${project.id}/quote`, { method: "POST" });
    const json = await res.json();
    setConverting(false);
    if (!res.ok) {
      // 409 means a quote already exists (the idempotency guard) -- follow
      // it there instead of just showing an error, since that's almost
      // certainly what the user actually wants.
      if (res.status === 409 && json.quoteId) { router.push(ROUTES.standardQuote(json.quoteId)); return; }
      setError(json.error ?? "Could not create the quote");
      return;
    }
    router.push(ROUTES.standardQuote(json.quoteId));
  }

  async function handleDelete() {
    if (!project) return;
    if (!window.confirm(`Delete "${project.name}"? This can't be undone.`)) return;
    setError("");
    setDeleting(true);
    const res = await fetch(`/api/fence-projects/${project.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) { const json = await res.json().catch(() => ({})); setError(json.error ?? "Could not delete the project"); return; }
    router.push(ROUTES.fenceProjects);
  }

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: c.panel2, color: c.ink, fontFamily: "inherit" }}>
      <div style={{ flex: "none", height: 48, display: "flex", alignItems: "center", gap: 14, padding: "0 16px", background: c.panel, borderBottom: `1px solid ${c.line}` }}>
        <Link href={ROUTES.fenceProjects} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← Fence Projects
        </Link>
        <Divider />
        <span style={{ fontWeight: 700, fontSize: 13.5, color: c.ink, whiteSpace: "nowrap" }}>Fence Design Studio</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ fontWeight: 600, fontSize: 13.5, border: "none", background: "none", color: c.ink, outline: "none", width: 220 }}
        />
        {project?.ref && (
          <span style={{ fontFamily: "monospace", fontSize: 10.5, color: c.muted, background: c.panel2, border: `1px solid ${c.line}`, borderRadius: 5, padding: "2px 7px" }}>
            {project.ref}
          </span>
        )}
        {project && (
          <Pill label={STATUS_LABEL[project.status]} tone={STATUS_TONE[project.status]} />
        )}
        <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 11.5, color: c.muted }}>
          {totalLength} m · {geometry.total_posts} posts · {gates.length} gate{gates.length === 1 ? "" : "s"}
        </span>
        {project?.standardQuoteId ? (
          <Link
            href={ROUTES.standardQuote(project.standardQuoteId)}
            style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, background: c.accentbg, color: c.accent, textDecoration: "none" }}
          >
            View quote →
          </Link>
        ) : (
          isEdit && (
            <button
              onClick={handleConvertToQuote}
              disabled={converting}
              style={{ padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: c.accentbg, color: c.accent, opacity: converting ? 0.6 : 1 }}
            >
              {converting ? "Converting…" : "Continue to quote"}
            </button>
          )
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: "6px 16px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: c.accent, color: "#fff", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : isEdit ? "Save" : "Save project"}
        </button>
        {isEdit && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${c.line}`, cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: "none", color: "#c2402f", opacity: deleting ? 0.6 : 1 }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      {error && (
        <div style={{ flex: "none", padding: "8px 16px", background: "#fdecea", color: "#c2402f", fontSize: 12.5 }}>{error}</div>
      )}
      {!error && isDirtySinceQuote && (
        <div style={{ flex: "none", padding: "8px 16px", background: c.accentbg, color: c.accent, fontSize: 12.5 }}>
          This project has changed since {project?.ref ?? "its quote"} was created — the quote won&rsquo;t reflect these changes.
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, position: "relative", background: view === "plan" ? `linear-gradient(${c.line} 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg, ${c.line} 1px, transparent 1px) 0 0/24px 24px, ${c.panel2}` : c.panel2 }}>
          {view === "plan" ? (
            <PlanView layout={layout} totalLength={totalLength} lineposts={geometry.line_posts} gates={gates} />
          ) : (
            <Fence3DView layout={layout} totalLength={totalLength} gates={gates} fabricHeight={fabricHeight} geometry={geometry} coating={coating} meshSpec={meshSpec} />
          )}
          <div style={{ position: "absolute", top: 12, left: 12, zIndex: 2 }}>
            <button
              onClick={() => setQuantitiesOpen((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 7, border: `1px solid ${c.line}`, cursor: "pointer",
                background: quantitiesOpen ? c.accentbg : c.panel, color: quantitiesOpen ? c.accent : c.ink,
                borderRadius: 8, boxShadow: sh.card, padding: "8px 14px", fontSize: 12.5, fontWeight: 600,
              }}
            >
              ≡ Quantities
            </button>
            {quantitiesOpen && (
              <div style={{ marginTop: 6, width: 300, maxHeight: 380, overflowY: "auto", background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10, boxShadow: sh.card, padding: 14 }}>
                {catalog.length === 0 ? (
                  <p style={{ fontSize: 11.5, color: c.muted, margin: 0 }}>No materials seeded for this tenant yet.</p>
                ) : (
                  <>
                    {quantitiesByCategory.map((group) => (
                      <div key={group.label} style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{group.label}</div>
                        {group.lines.map((r, i) => (
                          <div key={`${r.fence_kind}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderTop: `1px solid ${c.line}`, fontSize: 12 }}>
                            <span style={{ color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product_name ?? BOM_LABEL[r.fence_kind as BomLine["kind"]] ?? r.fence_kind}</span>
                            <span style={{ flex: "none", fontFamily: "monospace", color: c.muted }}>{r.qty} {r.uom}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 2px", borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
                      <b>Total</b>
                      <b style={{ fontFamily: "monospace" }}>{money(materialsCost)}</b>
                    </div>
                    {unresolvedCount > 0 && (
                      <p style={{ fontSize: 10.5, color: c.amber, marginTop: 8 }}>
                        {unresolvedCount} line{unresolvedCount === 1 ? "" : "s"} not priced -- no matching product for this pipe class / mesh / coating combination.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", background: c.panel, border: `1px solid ${c.line}`, borderRadius: 8, boxShadow: sh.card, padding: 3, gap: 3, zIndex: 2 }}>
            {(["plan", "3d"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  border: "none", cursor: "pointer", padding: "6px 12px", borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                  background: view === v ? c.accentbg : "none", color: view === v ? c.accent : c.muted,
                }}
              >
                {v === "plan" ? "Plan" : "3D"}
              </button>
            ))}
          </div>
          <div style={{ position: "absolute", left: 16, bottom: 16, background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10, boxShadow: sh.card, padding: "10px 14px", display: "flex", gap: 16 }}>
            <Stat label={layout === "closed_perimeter" ? "perimeter" : "run"} value={`${totalLength} m`} />
            <Divider />
            <Stat label="posts" value={String(geometry.total_posts)} />
            <Divider />
            <Stat label="fabric" value={`${Math.round(geometry.fabric_area_m2)} m²`} />
            <Divider />
            <Stat label="gates" value={String(gates.length)} />
          </div>
        </div>

        <div style={{ width: 340, flex: "none", background: c.panel, borderLeft: `1px solid ${c.line}`, overflowY: "auto", padding: 20 }}>
          <Collapsible
            label="Account"
            summary={accountId ? accounts.find((a) => a.id === accountId)?.name : "— None yet —"}
            open={accountSectionOpen}
            onToggle={() => setAccountSectionOpen((v) => !v)}
          >
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); }} style={inputStyle}>
              <option value="">— None yet —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {accountId && (
              <Field label="Contact">
                <select value={contactId} onChange={(e) => setContactId(e.target.value)} style={inputStyle}>
                  <option value="">— None —</option>
                  {contacts.filter((ct) => ct.account_id === accountId).map((ct) => (
                    <option key={ct.id} value={ct.id}>{ct.name}</option>
                  ))}
                </select>
              </Field>
            )}
          </Collapsible>

          <Divider block />

          <Collapsible
            label="What are you protecting?"
            summary={active.label}
            open={profileSectionOpen}
            onToggle={() => setProfileSectionOpen((v) => !v)}
          >
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                  border: `1px solid ${p.id === activeId ? c.accent : c.line}`,
                  boxShadow: p.id === activeId ? `0 0 0 2px ${c.accentbg}` : "none",
                  borderRadius: 9, padding: "10px 12px", marginBottom: 8, background: c.panel2,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
                <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>{p.blurb}</div>
              </button>
            ))}
            <button onClick={addProfile} style={ghostButtonStyle}>
              + Try a custom estimate
            </button>
          </Collapsible>

          {profiles.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => setCompareOpen((v) => !v)}
                style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                  border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel2, padding: "8px 12px",
                  fontSize: 12.5, fontWeight: 600, color: c.ink, cursor: "pointer",
                }}
              >
                Compare against every profile
                <span style={{ color: c.muted, fontWeight: 400 }}>{compareOpen ? "Hide ▲" : "Show ▼"}</span>
              </button>
              {compareOpen && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {comparisons.map((cmp) => (
                    <div
                      key={cmp.profile.id}
                      style={{
                        border: `1px solid ${cmp.profile.id === activeId ? c.accent : c.line}`,
                        boxShadow: cmp.profile.id === activeId ? `0 0 0 2px ${c.accentbg}` : "none",
                        borderRadius: 9, padding: "10px 12px", background: c.panel2,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <b style={{ fontSize: 12.5 }}>{cmp.profile.label}</b>
                        <b style={{ fontFamily: "monospace", fontSize: 13.5 }}>{money(cmp.cost)}</b>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: 10.5, color: c.muted, marginBottom: 8 }}>
                        <span>{cmp.profile.spacing} m spacing</span>
                        <span>{cmp.profile.pipe}</span>
                        <span>{cmp.profile.embedment} m embedment</span>
                        <span>{cmp.totalPosts} posts</span>
                        {cmp.unresolvedCount > 0 && <span style={{ color: c.amber }}>{cmp.unresolvedCount} unpriced</span>}
                      </div>
                      <button
                        onClick={() => setActiveId(cmp.profile.id)}
                        disabled={cmp.profile.id === activeId}
                        style={{
                          width: "100%", border: "none", borderRadius: 6, padding: "6px 0", fontSize: 11.5, fontWeight: 600, cursor: cmp.profile.id === activeId ? "default" : "pointer",
                          background: cmp.profile.id === activeId ? "none" : c.accentbg, color: cmp.profile.id === activeId ? c.muted : c.accent,
                        }}
                      >
                        {cmp.profile.id === activeId ? "Currently active" : "Use this profile"}
                      </button>
                    </div>
                  ))}
                  <p style={{ fontSize: 10.5, color: c.muted, margin: "2px 2px 0" }}>
                    Every profile keeps its own tuned numbers — switching to compare never overwrites another profile's edits.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeIsRealProfile ? (
            <p style={{ fontSize: 11, color: c.muted, marginTop: -8, marginBottom: 16 }}>
              Tenant profile — spacing/pipe/embedment below are a live estimate; edit the profile itself in Settings to change it for every project.
            </p>
          ) : (
            <p style={{ fontSize: 11, color: c.amber, marginTop: -8, marginBottom: 16 }}>
              Estimate-only profile — Save is disabled until you pick a real tenant profile above.
            </p>
          )}

          <Divider block />

          <Field label="Layout">
            <SegPair
              a={{ label: "Open run", active: layout === "open_run", onClick: () => setLayout("open_run") }}
              b={{ label: "Closed perimeter", active: layout === "closed_perimeter", onClick: () => setLayout("closed_perimeter") }}
            />
          </Field>

          <Field label={`Total length (${totalLength} m)`}>
            <input type="range" min={80} max={1400} step={10} value={totalLength} onChange={(e) => setTotalLength(+e.target.value)} style={{ width: "100%" }} />
          </Field>

          <Field label={`Post spacing (${active.spacing} m)`}>
            <input type="range" min={1.5} max={4} step={0.5} value={active.spacing} onChange={(e) => updateActive({ spacing: +e.target.value })} style={{ width: "100%" }} />
            <div style={{ fontSize: 10.5, color: c.muted, marginTop: 4 }}>Embedment depth: {active.embedment} m</div>
          </Field>

          <Field label="Pipe class">
            <select value={active.pipe} onChange={(e) => updateActive({ pipe: e.target.value })} style={inputStyle}>
              {pipeClasses.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>

          {profileTuned && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: -8, marginBottom: 15, padding: "8px 10px", borderRadius: 7, background: c.accentbg }}>
              <span style={{ fontSize: 11, color: c.accent }}>Tuned from &ldquo;{originalActiveProfile?.label}&rdquo; -- estimate only until saved.</span>
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                style={{ flex: "none", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 600, background: c.accent, color: "#fff", cursor: "pointer", opacity: savingProfile ? 0.6 : 1 }}
              >
                {savingProfile ? "Saving…" : "Save to profile"}
              </button>
            </div>
          )}

          <Field label={`Fabric height (${fabricHeight} m)`}>
            <input type="range" min={1} max={3} step={0.1} value={fabricHeight} onChange={(e) => setFabricHeight(+e.target.value)} style={{ width: "100%" }} />
          </Field>

          {meshSpecs.length > 0 && (
            <Field label="Fabric mesh">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={meshSpec} onChange={(e) => setMeshSpec(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                  {meshSpecs.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <MeshSwatch meshSpec={meshSpec} coating={coating} />
              </div>
            </Field>
          )}

          <Divider block />

          <Section label="Gates">
            {gates.map((g) => (
              <div key={g.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: c.panel2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{g.width_m} m gate</span>
                  <button onClick={() => setGates((gs) => gs.filter((x) => x.id !== g.id))} style={{ border: "none", background: "none", cursor: "pointer", color: c.muted }}>
                    ✕
                  </button>
                </div>
                <select
                  value={g.type}
                  onChange={(e) => updateGate(g.id, { type: e.target.value as FenceGateInput["type"] })}
                  style={{ ...inputStyle, marginBottom: 8 }}
                >
                  <option value="double_swing">Double swing</option>
                  <option value="single_swing">Single swing</option>
                  <option value="sliding">Sliding</option>
                </select>
                <input type="range" min={1} max={12} step={0.5} value={g.width_m} onChange={(e) => updateGate(g.id, { width_m: +e.target.value })} style={{ width: "100%" }} />
              </div>
            ))}
            <button onClick={() => setGates((gs) => [...gs, newGate()])} style={ghostButtonStyle}>
              + Add gate
            </button>
          </Section>

          <Divider block />

          <Section label="Accessories">
            {(
              [
                ["truss_rods", "Truss rods", "At every corner & straining post"],
                ["tension_wire", "Tension wire", "3 rows, stiffens the fabric edge"],
                ["tie_wire", "Tie wire", "Ties fabric to posts"],
                ["barbed_wire", "Barbed wire top", "3-strand outward arms"],
              ] as [keyof FenceAccessories, string, string][]
            ).map(([key, label, note]) => (
              <label key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${c.line}`, cursor: "pointer" }}>
                <span>
                  <div style={{ fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 11, color: c.muted }}>{note}</div>
                </span>
                <input type="checkbox" checked={accessories[key]} onChange={(e) => setAccessories((a) => ({ ...a, [key]: e.target.checked }))} />
              </label>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function PlanView({ layout, totalLength, gates }: { layout: FenceLayout; totalLength: number; lineposts: number; gates: (FenceGateInput & { id: number })[] }) {
  const scale = Math.max(0.4, Math.min(1, totalLength / 900));
  const w = 200 + scale * 340;
  const h = 130 + scale * 220;
  const x0 = 350 - w / 2;
  const y0 = 200 - h / 2;

  if (layout === "open_run") {
    const lx0 = 350 - w / 2;
    const lx1 = 350 + w / 2;
    return (
      <svg viewBox="0 0 700 400" style={{ width: "100%", height: "100%" }}>
        <line x1={lx0} y1={200} x2={lx1} y2={200} stroke={c.accent} strokeWidth={3} />
        <circle cx={lx0} cy={200} r={5} fill={c.accent} />
        <circle cx={lx1} cy={200} r={5} fill={c.accent} />
        <text x={350} y={182} textAnchor="middle" fontFamily="monospace" fontSize={12} fill={c.ink}>
          {totalLength} m open run
        </text>
      </svg>
    );
  }

  const per = (totalLength / 4).toFixed(0);
  const gateGapWidth = Math.min(w * 0.35, 60);
  let gx = x0 + 20;

  return (
    <svg viewBox="0 0 700 400" style={{ width: "100%", height: "100%" }}>
      <path d={`M${x0},${y0} L${x0 + w},${y0} L${x0 + w},${y0 + h} L${x0},${y0 + h} Z`} stroke={c.accent} strokeWidth={3} fill="none" />
      {[
        [x0, y0],
        [x0 + w, y0],
        [x0 + w, y0 + h],
        [x0, y0 + h],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={5} fill={c.accent} />
      ))}
      {gates.map((g) => {
        const gw = Math.min(gateGapWidth, w * 0.4);
        const x1 = gx;
        const x2 = gx + gw;
        gx += gw + (w - 40 - gw * gates.length) / Math.max(1, gates.length - 0.3);
        return (
          <g key={g.id}>
            <line x1={x1} y1={y0 + h} x2={x2} y2={y0 + h} stroke={c.amber} strokeWidth={3} strokeDasharray="4 4" />
            <text x={(x1 + x2) / 2} y={y0 + h + 16} textAnchor="middle" fontFamily="monospace" fontSize={10} fill={c.amber}>
              {g.width_m}m gate
            </text>
          </g>
        );
      })}
      <text x={350} y={y0 - 10} textAnchor="middle" fontFamily="monospace" fontSize={12} fill={c.ink}>
        {per} m per side · {totalLength} m total
      </text>
    </svg>
  );
}

// A collapsed-by-default section with its current value shown inline in
// the header -- the sidebar was reading as more than half screen just to
// show a single account picker and a 3-card profile list, both of which
// have a clear "current value" that doesn't need to stay expanded once set.
function Collapsible({ label, summary, open, onToggle, children }: { label: string; summary?: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          border: "none", background: "none", padding: 0, marginBottom: open ? 8 : 0, cursor: "pointer",
        }}
      >
        <span style={labelStyle}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: c.ink, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {!open && summary}
          <span style={{ color: c.muted, fontWeight: 400 }}>{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && children}
    </div>
  );
}
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 15 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <b style={{ fontFamily: "monospace", fontSize: 15, lineHeight: 1.2 }}>{value}</b>
      <span style={{ fontSize: 10.5, color: c.muted }}>{label}</span>
    </div>
  );
}
// A small live preview of the selected mesh -- the dropdown alone gave no
// visual feedback when changed (the 3D view was the only place it showed
// up, and only if you were on that tab). Gap spacing uses the same
// meshGapPx heuristic as the actual 3D texture, so this genuinely matches
// what you'd see there, not a decorative approximation.
function MeshSwatch({ meshSpec, coating }: { meshSpec: string; coating: string }) {
  const gap = meshGapPx(meshSpec);
  const tint = coating === "GI" ? "#c7cdd2" : coating === "Powder coated" ? "#2b2f33" : "#3f6b46";
  const lines: React.ReactNode[] = [];
  for (let i = -32; i < 64; i += gap) {
    lines.push(<line key={`a${i}`} x1={i} y1={0} x2={i + 32} y2={32} stroke={tint} strokeWidth={1.4} />);
    lines.push(<line key={`b${i}`} x1={i + 32} y1={0} x2={i} y2={32} stroke={tint} strokeWidth={1.4} />);
  }
  return (
    <svg width={36} height={36} viewBox="0 0 32 32" style={{ flex: "none", borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel2 }}>
      <clipPath id="meshSwatchClip"><rect x={0} y={0} width={32} height={32} /></clipPath>
      <g clipPath="url(#meshSwatchClip)">{lines}</g>
    </svg>
  );
}
function Divider({ block }: { block?: boolean }) {
  if (block) return <div style={{ height: 1, background: c.line, margin: "14px 0" }} />;
  return <div style={{ width: 1, height: 26, background: c.line }} />;
}
function SegPair({ a, b }: { a: { label: string; active: boolean; onClick: () => void }; b: { label: string; active: boolean; onClick: () => void } }) {
  const seg = (s: typeof a, first: boolean) => (
    <button
      onClick={s.onClick}
      style={{
        flex: 1, border: "none", cursor: "pointer", padding: "7px 6px", fontSize: 12, fontWeight: 500,
        borderLeft: first ? "none" : `1px solid ${c.line}`,
        background: s.active ? c.accent : c.panel2,
        color: s.active ? "#fff" : c.muted,
      }}
    >
      {s.label}
    </button>
  );
  return (
    <div style={{ display: "flex", border: `1px solid ${c.line}`, borderRadius: 7, overflow: "hidden" }}>
      {seg(a, true)}
      {seg(b, false)}
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: "100%", border: `1px solid ${c.line}`, background: c.panel2, color: c.ink, borderRadius: 7, padding: "7px 9px", fontSize: 13 };
const ghostButtonStyle: React.CSSProperties = { width: "100%", border: `1px dashed ${c.line}`, background: "none", borderRadius: 8, padding: 8, color: c.accent, fontWeight: 600, fontSize: 12.5, cursor: "pointer" };
