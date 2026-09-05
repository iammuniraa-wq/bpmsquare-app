"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import { useUserRole } from "@/lib/tenant-context";
import { useFeel } from "@/components/FeelProvider";

/**
 * Delete a project created by mistake.
 *
 * Deliberately plain text at the end of the page rather than a button in the
 * header: this is the rare action, and a red button beside "Save changes" is
 * the one people hit by accident. The real guards are server-side -- admin
 * only, and refused outright while anything still sits underneath it.
 *
 * Punches are NOT deleted with it. wfm_presence_events.project_id is
 * `on delete set null`, so the hours become unassigned and stay visible on
 * the Projects screen; attendance evidence must survive a costing decision.
 * The confirm says so, because "delete the project" reads like "delete the
 * attendance" to anyone who hasn't been told otherwise.
 */
export default function DeleteProject({
  projectId, name, parentId,
}: {
  projectId: string;
  name: string;
  /** Set when this is a part -- deleting it returns to the parent it lived
   *  in, not to the top-level list, which is where you were working. */
  parentId: string | null;
}) {
  const isPart = !!parentId;
  const router = useRouter();
  const { confirm } = useFeel();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (useUserRole() !== "admin") return null;

  async function remove() {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      body: "Hours already booked to it become unassigned. The punches themselves are kept, so nobody's attendance changes.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/wfm/projects/${projectId}`, { method: "DELETE" }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setBusy(false);
      setError(!res ? "Network error — nothing was deleted." : (json.error ?? "Could not delete it."));
      return;
    }
    router.push(parentId ? ROUTES.wfmProject(parentId) : ROUTES.wfmProjects);
    router.refresh();
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        style={{
          background: "none", border: "none", padding: 0, cursor: busy ? "default" : "pointer",
          fontSize: 12.5, fontWeight: 600, color: "var(--err-ink)", opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Deleting…" : `Delete this ${isPart ? "part" : "project"}`}
      </button>
      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 5, lineHeight: 1.5 }}>
        For something created by mistake. Hours already booked to it become unassigned — the
        punches are kept.
      </div>
      {error && <div style={{ fontSize: 12.5, color: "var(--err-ink)", marginTop: 8 }}>{error}</div>}
    </div>
  );
}
