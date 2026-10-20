"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import { useFeel } from "@/components/FeelProvider";
import { REQUIRABLE_ROLES, ROLE_LABEL, type AbmRole } from "@/lib/abm/types";
import Modal from "./Modal";

/** Runs the progress rules over every target now. Nothing runs by itself in this version: a person presses this. */
export function CheckProgressButton({ programId }: { programId: string }) {
  const router = useRouter();
  const { toast } = useFeel();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const res = await fetch(`/api/abm/programs/${programId}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: "progress" }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast({ text: j.error ?? "Could not check progress", tone: "error" }); return; }
    toast({ text: j.changed ? `${j.changed} ${j.changed === 1 ? "company" : "companies"} moved forward` : "Nothing new has happened", tone: "success" });
    router.refresh();
  }
  return <Button onClick={run} loading={busy}>Check progress</Button>;
}

type Diff = { new: { id: string; name: string }[]; no_longer_matching: { target_id: string; name: string }[] };

/** Refresh from source: shows what changed in the saved group or segment and applies only what is ticked. */
export function RefreshSourceButton({ programId }: { programId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [add, setAdd] = useState<Set<string>>(new Set());
  const [drop, setDrop] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setOpen(true); setError(""); setDiff(null);
    const res = await fetch(`/api/abm/programs/${programId}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: "source" }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not compare with the source."); return; }
    setDiff(j as Diff); setAdd(new Set()); setDrop(new Set());
  }
  async function apply() {
    setBusy(true);
    const res = await fetch(`/api/abm/programs/${programId}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: "source", add: [...add], drop: [...drop] }) });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? "Could not apply."); return; }
    setOpen(false);
    router.refresh();
  }
  const flip = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n); };

  return (
    <>
      <Button onClick={load}>Refresh from source</Button>
      {open && (
        <Modal title="Refresh from the source list" onClose={() => setOpen(false)} width={520}>
          {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13 }}>{error}</div>}
          {!diff && !error && <div style={{ color: c.muted, fontSize: 13 }}>Comparing…</div>}
          {diff && (
            <div style={{ fontSize: 13.5, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ color: c.muted }}>Tick what you want to apply. Nothing changes until you press Apply.</div>
              <div>
                <b>New in the source ({diff.new.length})</b>
                {diff.new.length === 0 && <div style={{ color: c.hint }}>Nothing new.</div>}
                {diff.new.map((n) => <label key={n.id} style={{ display: "flex", gap: 8, marginTop: 4 }}><input type="checkbox" checked={add.has(n.id)} onChange={() => flip(add, n.id, setAdd)} /> Add {n.name}</label>)}
              </div>
              <div>
                <b>No longer in the source ({diff.no_longer_matching.length})</b>
                {diff.no_longer_matching.length === 0 && <div style={{ color: c.hint }}>Everyone still matches.</div>}
                {diff.no_longer_matching.map((n) => <label key={n.target_id} style={{ display: "flex", gap: 8, marginTop: 4 }}><input type="checkbox" checked={drop.has(n.target_id)} onChange={() => flip(drop, n.target_id, setDrop)} /> Drop {n.name} (kept in the list as Dropped, with the reason)</label>)}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" loading={busy} disabled={add.size + drop.size === 0} onClick={apply}>Apply</Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/** The roles every company in this program needs; saved as soon as it is changed. */
export function RequiredRolesEditor({ programId, roles, canEdit }: { programId: string; roles: AbmRole[]; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useFeel();
  const [value, setValue] = useState<AbmRole[]>(roles);
  async function toggle(r: AbmRole) {
    const next = value.includes(r) ? value.filter((x) => x !== r) : [...value, r];
    if (next.length === 0) { toast({ text: "A program needs at least one required role.", tone: "error" }); return; }
    setValue(next);
    const res = await fetch(`/api/abm/programs/${programId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ required_roles: next }) });
    if (!res.ok) { setValue(value); toast({ text: "Could not save the roles", tone: "error" }); return; }
    router.refresh();
  }
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {REQUIRABLE_ROLES.map((r) => (
        <label key={r} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={value.includes(r)} disabled={!canEdit} onChange={() => toggle(r)} /> {ROLE_LABEL[r]}
        </label>
      ))}
    </div>
  );
}
