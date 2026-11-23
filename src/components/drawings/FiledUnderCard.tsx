"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Select } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { DRAWING_TIPS } from "@/lib/drawings/tips";
import { call } from "./api";
import s from "./Drawings.module.css";

type Options = { tenders: { id: string; label: string }[]; projects: { id: string; label: string }[]; buildings: { id: string; label: string }[] };

// Where the drawing is filed: a tender, a project, a building. Every id is checked against this workspace on the server before it is saved.

export default function FiledUnderCard({ drawingId, opportunityId, projectId, wbsItemId, canEdit }: { drawingId: string; opportunityId: string | null; projectId: string | null; wbsItemId: string | null; canEdit: boolean }) {
  const router = useRouter();
  const feel = useFeel();
  const [opp, setOpp] = useState(opportunityId ?? "");
  const [prj, setPrj] = useState(projectId ?? "");
  const [bld, setBld] = useState(wbsItemId ?? "");
  const [opts, setOpts] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    call<Options>(`/api/drawings/options${opp ? `?opportunity_id=${opp}` : ""}`, "GET").then((r) => { if (live && r.ok) setOpts(r.data); });
    return () => { live = false; };
  }, [opp]);

  const dirty = opp !== (opportunityId ?? "") || prj !== (projectId ?? "") || bld !== (wbsItemId ?? "");
  async function save() {
    setBusy(true); setError("");
    const r = await call(`/api/drawings/${drawingId}`, "PATCH", { opportunity_id: opp || null, project_id: prj || null, wbs_item_id: bld || null });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    feel.toast({ text: "Saved", tone: "success" });
    router.refresh();
  }

  return (
    <Card title="Filed under" info={DRAWING_TIPS.filedUnder} padding={14}>
      {error && <div role="alert" className={s.alert} style={{ marginBottom: 10 }}>{error}</div>}
      <div className={s.two}>
        <Field label="Tender">
          <Select value={opp} disabled={!canEdit} onChange={(e) => { setOpp(e.target.value); setBld(""); }}>
            <option value="">None</option>
            {opts?.tenders.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Building">
          <Select value={bld} disabled={!canEdit || !opp} onChange={(e) => setBld(e.target.value)}>
            <option value="">None</option>
            {opts?.buildings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </Select>
        </Field>
        <Field label="Project" style={{ marginBottom: 0 }}>
          <Select value={prj} disabled={!canEdit} onChange={(e) => setPrj(e.target.value)}>
            <option value="">None</option>
            {opts?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
      </div>
      {canEdit && dirty && <div className={s.actions} style={{ marginTop: 10 }}><Button size="sm" variant="primary" loading={busy} onClick={save}>Save</Button></div>}
    </Card>
  );
}
