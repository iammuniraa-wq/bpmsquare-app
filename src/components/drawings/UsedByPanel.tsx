"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { Input, Select } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { DRAWING_TIPS } from "@/lib/drawings/tips";
import { call } from "./api";
import { fmtNum } from "./view";
import s from "./Drawings.module.css";

// The Used by tab: the tender lines that take a quantity from this drawing. A later release flags a line and changes nothing by itself;
// a person applies the new quantity or keeps the old one and says why. The client's own quantity is never touched: the model quantity
// sits beside it.

export type PinRowView = {
  boq_id: string; opportunity_id: string; item_no: string | null; row_no: number; description: string; client_qty: number; element_code: string | null;
  pinned_label: string; current_label: string | null; model_qty: number | null; state: "current" | "review" | "dismissed"; chip: string; differs_pct: number | null; dismissed_reason: string | null;
};
type Options = { lines: { id: string; label: string; client_qty: number; pinned: boolean }[]; groups: { key: string; drawing_id: string; element_code: string | null; element_type: string; building: string; pieces: number; drawing_no: string; rev_label: string }[] };

export default function UsedByPanel({ drawingId, opportunityId, pins, canEdit, hasRelease }: { drawingId: string; opportunityId: string | null; pins: PinRowView[]; canEdit: boolean; hasRelease: boolean }) {
  const router = useRouter();
  const feel = useFeel();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [opts, setOpts] = useState<Options | null>(null);
  const [line, setLine] = useState("");
  const [code, setCode] = useState("");

  async function act(pin: PinRowView, action: "apply" | "dismiss" | "remove") {
    setBusy(pin.boq_id + action); setError("");
    const url = `/api/opportunities/${pin.opportunity_id}/drawings/${pin.boq_id}`;
    const r = action === "remove" ? await call(url, "DELETE") : await call(url, "PATCH", action === "apply" ? { action } : { action, reason });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setDismissing(null); setReason("");
    feel.toast({ text: action === "apply" ? "Quantity updated" : action === "dismiss" ? "Kept as it is" : "Removed", tone: "success" });
    router.refresh();
  }

  async function openAdd() {
    if (!opportunityId) return;
    setAdding(true); setError("");
    const r = await call<Options>(`/api/opportunities/${opportunityId}/drawings`, "GET");
    if (r.ok) setOpts({ lines: r.data.lines, groups: r.data.groups.filter((g) => g.drawing_id === drawingId) }); else setError(r.error);
  }

  async function pin() {
    if (!opportunityId || !line || !code) return;
    setBusy("pin"); setError("");
    const r = await call(`/api/opportunities/${opportunityId}/drawings`, "POST", { boq_line_id: line, drawing_id: drawingId, element_code: code });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setAdding(false); setLine(""); setCode("");
    feel.toast({ text: "Quantity taken from the drawing", tone: "success" });
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div role="alert" className={s.alert}>{error}</div>}
      <Card title="Tender lines using this drawing" info={DRAWING_TIPS.usedBy} padding={14}
        action={canEdit && opportunityId && hasRelease ? <Button size="sm" onClick={openAdd} data-guide="drawings.pin_add">Use in a line</Button> : undefined}>
        {pins.length === 0 ? (
          <EmptyState title="No line uses this drawing yet"
            text={!opportunityId ? "File the drawing under a tender to take quantities from it." : !hasRelease ? "Release a revision first. Only a released revision can feed a bill of quantities." : "Choose Use in a line to take a quantity from a released element code."} />
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Line</th><th>Code</th><th className={s.num}>Client qty</th><th className={s.num}>Model qty</th><th>Status</th><th /></tr></thead>
              <tbody>
                {pins.map((p) => (
                  <tr key={p.boq_id}>
                    <td><Link href={`/pipeline/${p.opportunity_id}`}>{p.item_no ?? `#${p.row_no}`}</Link> {p.description}</td>
                    <td>{p.element_code}</td>
                    <td className={s.num}>{fmtNum(p.client_qty, 3)}</td>
                    <td className={s.num}>{fmtNum(p.model_qty, 3)}{p.differs_pct != null && <> <StatusPill label={`differs by ${Math.abs(p.differs_pct)} %`} tone="amber" /></>}</td>
                    <td>
                      <StatusPill label={p.chip} tone={p.state === "review" ? "amber" : p.state === "dismissed" ? "purple" : "green"} />
                      {p.dismissed_reason && <div className={s.quiet} style={{ fontSize: 12 }}>Kept: {p.dismissed_reason}</div>}
                    </td>
                    <td>
                      {canEdit && (
                        <div className={s.actions}>
                          {p.state === "review" && <Button size="sm" variant="primary" loading={busy === p.boq_id + "apply"} onClick={() => act(p, "apply")} data-guide="drawings.pin_apply">Apply</Button>}
                          {p.state === "review" && <Button size="sm" onClick={() => { setDismissing(dismissing === p.boq_id ? null : p.boq_id); setReason(""); }}>Keep old</Button>}
                          <Button size="sm" variant="quiet" onClick={() => act(p, "remove")}>Remove</Button>
                        </div>
                      )}
                      {dismissing === p.boq_id && (
                        <div className={s.returnBox}>
                          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the quantity stays" aria-label="Reason" />
                          <Button size="sm" variant="primary" disabled={!reason.trim()} loading={busy === p.boq_id + "dismiss"} onClick={() => act(p, "dismiss")}>Keep it</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && (
        <Card title="Take a quantity from the drawing" info={DRAWING_TIPS.pin} padding={14}>
          {!opts ? <p className={s.quiet}>Loading</p> : (
            <div className={s.two}>
              <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>BOQ line
                <Select value={line} onChange={(e) => setLine(e.target.value)}>
                  <option value="">Choose a line</option>
                  {opts.lines.map((l) => <option key={l.id} value={l.id}>{l.label} (client {fmtNum(l.client_qty, 3)}){l.pinned ? " - has a drawing" : ""}</option>)}
                </Select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Element code in the released revision
                <Select value={code} onChange={(e) => setCode(e.target.value)}>
                  <option value="">Choose a code</option>
                  {opts.groups.filter((g) => g.element_code).map((g) => <option key={g.key} value={g.element_code!}>{g.element_code} ({g.element_type}, {g.building}): {fmtNum(g.pieces, 3)}</option>)}
                </Select>
              </label>
            </div>
          )}
          <div className={s.actions} style={{ marginTop: 10 }}>
            <Button size="sm" variant="primary" disabled={!line || !code} loading={busy === "pin"} onClick={pin}>Take quantity</Button>
            <Button size="sm" variant="quiet" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
