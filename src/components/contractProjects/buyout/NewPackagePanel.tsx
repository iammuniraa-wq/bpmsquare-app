"use client";

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { money } from "@/lib/contractProjects/format";
import { createPackage } from "./api";
import { BUYOUT_TIPS } from "./tips";
import { KIND_LABEL, PACKAGE_KINDS, type BudgetLineRow, type PackageKind, type PackageRow } from "./types";

// New package: a name, a kind, and the budget lines not yet in any package. A side panel on a desktop, a bottom sheet on a phone (the shared
// SidePanel). The server checks again that every line is on this project and free, so nothing here is trusted.

const PAGE = 12;

export default function NewPackagePanel({ projectId, lines, currency, onClose, onCreated }: {
  projectId: string;
  lines: BudgetLineRow[];
  currency: string | null;
  onClose: () => void;
  /** After a package is made: the tab re-reads, then opens it. */
  onCreated: (created: PackageRow | null) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PackageKind>("supplier");
  const [chosen, setChosen] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return t ? lines.filter((l) => `${l.description} ${l.wbs ?? ""} ${l.cost_code ?? ""}`.toLowerCase().includes(t)) : lines;
  }, [lines, filter]);
  const visible = showAll || filter ? shown : shown.slice(0, PAGE);
  const toggle = (id: string) => setChosen((cs) => (cs.includes(id) ? cs.filter((x) => x !== id) : [...cs, id]));
  const chosenTotal = lines.filter((l) => chosen.includes(l.id)).reduce((s, l) => s + (l.amount ?? 0), 0);
  const ready = !busy && name.trim().length > 0 && chosen.length > 0;

  async function submit() {
    setError(""); setBusy(true);
    try {
      const r = await createPackage<PackageRow & { package?: PackageRow }>(projectId, { name: name.trim(), kind, budget_line_ids: chosen });
      if (!r.ok) { setError(r.json.error ?? "Could not create the package"); return; }
      onCreated(r.json.package ?? (r.json.id ? (r.json as PackageRow) : null));
    } finally { setBusy(false); }
  }

  return (
    <SidePanel
      title="New package" subtitle={chosen.length > 0 ? `${chosen.length} line${chosen.length === 1 ? "" : "s"}, ${money(chosenTotal, currency)}` : undefined} label="New package" onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} style={{ minHeight: 44 }} data-guide="buyout.new.cancel">Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()} style={{ minHeight: 44 }} data-guide="buyout.new.create">Create package</Button>
        </>
      }
    >
      <div className="bpm-tap" data-guide="buyout.new" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <Field label="Name" required info={BUYOUT_TIPS.newPackage} guide="buyout.new.field.name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="HDPE pipe supply" autoFocus />
        </Field>
        <Field label="Kind" info={BUYOUT_TIPS.kind} guide="buyout.new.field.kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as PackageKind)}>
            {PACKAGE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>

        <div data-guide="buyout.new.lines">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <span className="bpm-t-label">Budget lines</span>
            {lines.length > 0 && (
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="buyout.new.all" onClick={() => setChosen(shown.map((l) => l.id))}>All</Button>
                <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="buyout.new.none" onClick={() => setChosen([])}>None</Button>
              </span>
            )}
          </div>
          {lines.length === 0 ? (
            <div role="status" data-guide="buyout.new.empty" style={{ fontSize: 13, color: c.muted }}>Every budget line is already in a package. Add lines on the Budget tab first.</div>
          ) : (
            <>
              {lines.length > PAGE && <Input aria-label="Search budget lines" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search lines…" style={{ marginBottom: 6 }} />}
              <div style={{ border: `1px solid ${c.line}`, borderRadius: 8 }}>
                {visible.map((l) => (
                  <label key={l.id} data-guide="buyout.new.line" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", minHeight: 44, borderBottom: `1px solid ${c.line}`, cursor: "pointer", fontSize: 13, color: c.ink }}>
                    <input type="checkbox" checked={chosen.includes(l.id)} onChange={() => toggle(l.id)} style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{l.wbs ? `${l.wbs} · ` : l.line_no ? `${l.line_no} · ` : ""}{l.description}</span>
                      <span style={{ display: "block", fontSize: 12, color: c.hint }}>{[l.qty != null ? `${l.qty}${l.unit ? ` ${l.unit}` : ""}` : null, l.cost_code].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: c.muted, whiteSpace: "nowrap" }}>{l.amount != null ? money(l.amount, currency) : ""}</span>
                  </label>
                ))}
                {visible.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: c.hint }}>No lines match.</div>}
              </div>
              {!filter && shown.length > PAGE && (
                <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="buyout.new.show_all" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${shown.length}`}</Button>
              )}
            </>
          )}
        </div>
      </div>
    </SidePanel>
  );
}
