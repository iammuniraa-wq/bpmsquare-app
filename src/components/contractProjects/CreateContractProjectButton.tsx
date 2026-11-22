"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { ROUTES } from "@/lib/constants";
import { money } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

export type QuoteProjectSource = "standard_quote" | "quotation" | "estimate";

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 13, minHeight: 28 };

/**
 * "Create contract project" on an accepted quote, a won quotation or an estimate whose quote was accepted. One small confirm: the name, a
 * manager and a planned start, with the two numbers that matter (budget lines and contract value) shown, not typed. A second press for a
 * quote that already has a project (another tab, a colleague) opens that project instead of making another.
 */
export default function CreateContractProjectButton({ sourceType, sourceId, defaultName, lineCount, contractValue, currency, members, variant = "secondary" }: {
  sourceType: QuoteProjectSource;
  sourceId: string;
  defaultName: string;
  lineCount: number;
  contractValue: number;
  currency: string | null;
  members: { user_id: string; name: string | null; email: string | null }[];
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({ name: defaultName, manager_id: "", planned_start: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function create() {
    setBusy(true); setError("");
    const res = await fetch("/api/contract-projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [`${sourceType}_id`]: sourceId, name: f.name.trim() || undefined, manager_id: f.manager_id || undefined, planned_start: f.planned_start || undefined }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok || j.project_id) { router.push(ROUTES.contractProject(j.id ?? j.project_id)); return; }
    setBusy(false);
    setError(j.error ?? "Could not create the contract project");
  }

  return (
    <>
      <Button variant={variant} data-guide="quote.create_project" style={{ minHeight: 44 }} onClick={() => setOpen(true)}>Create contract project</Button>
      {open && (
        <SidePanel
          title="Create contract project"
          subtitle={<InfoTip label="Create contract project">{PROJECT_TIPS.fromQuote}</InfoTip>}
          onClose={() => { if (!busy) setOpen(false); }}
          footer={
            <>
              <Button variant="primary" loading={busy} data-guide="quote.create_project.confirm" style={{ minHeight: 44 }} onClick={() => void create()}>Create project</Button>
              <Button variant="secondary" disabled={busy} style={{ minHeight: 44 }} onClick={() => setOpen(false)}>Cancel</Button>
            </>
          }
        >
          <div data-guide="quote.create_project.panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={row}><dt style={{ color: c.muted }}>Budget lines</dt><dd style={{ margin: 0, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{lineCount}</dd></div>
              <div style={row}><dt style={{ color: c.muted }}>Contract value</dt><dd style={{ margin: 0, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{money(contractValue, currency)}</dd></div>
            </dl>
            <Field label="Project name" guide="quote.create_project.name"><Input value={f.name} onChange={set("name")} maxLength={200} /></Field>
            <Field label="Manager" guide="quote.create_project.manager">
              <Select value={f.manager_id} onChange={set("manager_id")}>
                <option value="">— None —</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
              </Select>
            </Field>
            <Field label="Planned start" guide="quote.create_project.start"><Input type="date" value={f.planned_start} onChange={set("planned_start")} /></Field>
            {error && <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{error}</div>}
          </div>
        </SidePanel>
      )}
    </>
  );
}
