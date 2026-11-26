"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/contractProjects/format";
import { PF_TIPS } from "@/lib/projectFinance/tips";
import type { CellForecast } from "@/lib/projectFinance/rules";
import type { EtgEntry } from "@/lib/projectFinance/model";
import { pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import s from "./projectFinance.module.css";

const NOT_CONNECTED = "Not connected";

type Group = { resource: string; name: string; cells: CellForecast[] };

/**
 * The cost by category (design section 7): one card per resource type with its budget, and (once the ERP cost is read back) its actual,
 * committed, estimate to go and forecast. The estimate to go is the only thing typed here: one box per cost cell (WBS item x resource type),
 * empty meaning "the budget holds". Saved with the one button; nothing else on the screen edits cost.
 */
export default function ForecastPanel({ projectId, currency, cells, labels, entries, connected, canEdit, etgMissing }: {
  projectId: string; currency: string | null; cells: CellForecast[];
  labels: { resource: Record<string, string>; wbs: Record<string, string> };
  entries: EtgEntry[]; connected: boolean; canEdit: boolean; etgMissing: boolean;
}) {
  const router = useRouter();
  const typedNow = useMemo(() => new Map(cells.filter((c) => c.typed !== null).map((c) => [c.key, String(c.typed)])), [cells]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const by = useMemo(() => new Map(entries.map((e) => [`${e.wbs_code}|${e.resource_code}`, e])), [entries]);

  const groups: Group[] = useMemo(() => {
    const m = new Map<string, CellForecast[]>();
    for (const c of cells) m.set(c.resource_code, [...(m.get(c.resource_code) ?? []), c]);
    return [...m.entries()].map(([resource, cs]) => ({ resource, name: resource ? labels.resource[resource] ?? resource : "No resource type", cells: cs }))
      .sort((a, b) => a.resource.localeCompare(b.resource, undefined, { numeric: true }));
  }, [cells, labels.resource]);

  const valueOf = (key: string) => (key in edits ? edits[key] : typedNow.get(key) ?? "");
  const changed = Object.keys(edits).filter((k) => (edits[k].trim() === "" ? "" : String(Number(edits[k]))) !== (typedNow.get(k) ?? ""));
  const sum = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : Math.round(xs.reduce<number>((t, x) => t + (x as number), 0) * 100) / 100);

  async function save() {
    setBusy(true); setMsg(null);
    const body = { entries: changed.map((k) => {
      const i = k.indexOf("|");
      const raw = edits[k].trim();
      return { wbs_code: k.slice(0, i), resource_code: k.slice(i + 1), amount: raw === "" ? null : Number(raw) };
    }) };
    const res = await fetch(`/api/contract-projects/${projectId}/forecast`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save the forecast." }); return; }
    setEdits({}); setMsg({ ok: true, text: "Forecast updated." });
    router.refresh();
  }

  if (groups.length === 0) return <p className={s.quiet} role="status">There are no budget lines yet, so there is nothing to forecast.</p>;

  return (
    <div className={s.stack} data-guide="pf.forecast_table">
      {etgMissing && <p role="alert" style={{ margin: 0, fontSize: 13, color: pillar.amber.fg }}>Saving an estimate needs a database update (migration 0261). Ask your administrator to apply it.</p>}
      {groups.map((g) => {
        const budget = sum(g.cells.map((c) => c.budget));
        const etg = sum(g.cells.map((c) => (c.key in edits && edits[c.key].trim() !== "" && Number.isFinite(Number(edits[c.key])) ? Number(edits[c.key]) : c.etg)));
        const actual = sum(g.cells.map((c) => c.actual));
        const committed = sum(g.cells.map((c) => c.committed));
        const eac = actual !== null && committed !== null && etg !== null ? Math.round((actual + committed + etg) * 100) / 100 : null;
        const isOpen = open[g.resource] === true;
        const over = eac !== null && budget !== null && eac > budget;
        return (
          <section key={g.resource} className={s.cat} data-guide={`pf.cat.${g.resource || "none"}`}>
            <div className={s.catHead}>
              <button type="button" className={s.toggle} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${g.name} rows`} onClick={() => setOpen((o) => ({ ...o, [g.resource]: !isOpen }))}>
                <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
              </button>
              <span className={s.catName}>{g.name}</span>
              {over && <span className={s.flag} style={{ color: pillar.red.fg }}>Over budget</span>}
              {g.cells.some((c) => c.unmapped) && <span className={s.flag}>Unmapped cost</span>}
            </div>
            <div className={s.catFigs}>
              <Fig label="Budget" value={money(budget, currency)} />
              <Fig label="Actual" value={actual === null ? NOT_CONNECTED : money(actual, currency)} muted={actual === null} />
              <Fig label="Committed" value={committed === null ? NOT_CONNECTED : money(committed, currency)} muted={committed === null} />
              <Fig label="Estimate to go" value={etg === null ? NOT_CONNECTED : money(etg, currency)} muted={etg === null} info={PF_TIPS.etg} />
              <Fig label="Forecast" value={eac === null ? NOT_CONNECTED : money(eac, currency)} muted={eac === null} />
            </div>
            {isOpen && g.cells.map((c) => {
              const e = by.get(c.key);
              return (
                <div key={c.key} className={s.cellRow}>
                  <div className={s.catHead}>
                    <span className={s.catName}>{c.wbs_code ? `${c.wbs_code}${labels.wbs[c.wbs_code] && labels.wbs[c.wbs_code] !== c.wbs_code ? ` ${labels.wbs[c.wbs_code]}` : ""}` : "No WBS item"}</span>
                    <span className={s.quiet}>Budget {money(c.budget, currency)}</span>
                    {c.overBudget && <span className={s.flag}>Over budget, no estimate typed</span>}
                  </div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--hint)", marginTop: 4 }}>
                    Estimate to go
                    <input
                      className={s.input} type="number" inputMode="decimal" min={0} step="any" disabled={!canEdit || etgMissing} value={valueOf(c.key)}
                      placeholder={c.etgSource === "default" && c.etg !== null ? `Budget holds: ${money(c.etg, currency)}` : "Budget holds"}
                      onChange={(ev) => setEdits((x) => ({ ...x, [c.key]: ev.target.value }))} data-guide="pf.etg_input" aria-label={`Estimate to go for ${g.name}${c.wbs_code ? `, ${c.wbs_code}` : ""}`}
                    />
                  </label>
                  {e && <p className={s.quiet}>{`Typed by ${e.entered_by_name ?? "a team member"}${e.entered_at ? ` on ${new Date(e.entered_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}${e.note ? `: ${e.note}` : ""}`}</p>}
                </div>
              );
            })}
          </section>
        );
      })}
      {!connected && <p className={s.quiet}>Actual, committed and the forecast are blank until the ERP cost is read back. What you type here is kept.</p>}
      {canEdit && !etgMissing && (
        <div className={s.sticky}>
          {msg && <span role="status" style={{ fontSize: 13, color: msg.ok ? "var(--ink)" : pillar.red.fg }}>{msg.text}</span>}
          <Button variant="primary" loading={busy} disabled={busy || changed.length === 0} onClick={() => void save()} data-guide="pf.update_forecast">Update forecast</Button>
        </div>
      )}
    </div>
  );
}

function Fig({ label, value, muted, info }: { label: string; value: string; muted?: boolean; info?: string }) {
  return (
    <div className={s.fig}>
      <div className={s.figLabel}>{label}{info && <InfoTip label={label}>{info}</InfoTip>}</div>
      <div className={s.figValue} style={muted ? { color: "var(--hint)", fontWeight: 500 } : undefined}>{value}</div>
    </div>
  );
}
