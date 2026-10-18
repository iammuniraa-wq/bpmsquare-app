"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { ESTIMATE_COMPONENTS, ESTIMATE_COMPONENT_LABEL, type EstimateComponent } from "@/lib/estimator/types";

/** Adds a manual line: it survives every recalculation. */
export default function AddLineForm({ estimateId, groupNames }: { estimateId: string; groupNames: string[] }) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [uom, setUom] = useState("");
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [component, setComponent] = useState<EstimateComponent>("other");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) { setError("Describe the line."); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/estimates/${estimateId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(), group: group.trim() || undefined, uom: uom.trim() || undefined,
          qty: Number(qty), unit_cost: unitCost.trim() === "" ? undefined : Number(unitCost), component,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not add the line."); return; }
      setDescription(""); setGroup(""); setUom(""); setQty("1"); setUnitCost(""); setComponent("other");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return <div><Button variant="secondary" size="sm" onClick={() => setOpen(true)}>+ Add a line</Button></div>;
  }
  return (
    <Card title="Add a manual line" padding={18}>
      <form onSubmit={submit}>
        <Field label="Description" required><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} required /></Field>
        <div className="fg2">
          <Field label="Group" hint="An existing group, or a new name.">
            <Input value={group} onChange={(e) => setGroup(e.target.value)} list={listId} placeholder="Manual items" />
            <datalist id={listId}>{groupNames.map((g) => <option key={g} value={g} />)}</datalist>
          </Field>
          <Field label="Cost component">
            <Select value={component} onChange={(e) => setComponent(e.target.value as EstimateComponent)}>
              {ESTIMATE_COMPONENTS.map((k) => <option key={k} value={k}>{ESTIMATE_COMPONENT_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Unit"><Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="e.g. m3, nr, lot" maxLength={20} /></Field>
          <Field label="Quantity"><Input type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Unit cost" hint="Leave empty if you don't know it yet; the estimate can't be quoted until it has one."><Input type="number" step="any" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
        </div>
        {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)", marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>Add line</Button>
        </div>
      </form>
    </Card>
  );
}
