"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import EmptyState from "@/components/ui/EmptyState";
import StatTile from "@/components/ui/StatTile";
import { Select, Textarea } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { STATUS_LABEL } from "@/lib/drawings/types";
import { COMPARED_FIELDS } from "@/lib/drawings/types";
import type { Comparison, CompareRow } from "@/lib/drawings/compare";
import { DRAWING_TIPS } from "@/lib/drawings/tips";
import { call } from "./api";
import { fmtNum, type RevisionView } from "./view";
import s from "./Drawings.module.css";

// The comparison screen (design section 5): how a new revision differs from the last release, element by element. Computed, never AI.
// It reads and writes nothing about the BOQ or the budget; the effect on the lines that take a quantity from this drawing is shown beside
// it, and a person applies or dismisses each AFTER the release (Used by tab).

type Effect = { boq_id: string; opportunity_id: string; item: string; description: string; element_code: string; was: number; becomes: number; delta: number; pinned_label: string; state: string };
type Answer = { from: RevisionView | null; to: RevisionView; comparison: Omit<Comparison, "rows"> & { rows: CompareRow[]; unchangedShown: boolean }; unchangedRows: number; hasElements: { from: boolean; to: boolean }; effect: Effect[] };
type Filter = "all" | "added" | "removed" | "changed";

const FIELD_LABEL: Record<(typeof COMPARED_FIELDS)[number], string> = { qty: "Pieces", unit: "Unit", volume_m3: "Volume m3", area_m2: "Area m2", length_m: "Length m", weight_t: "Weight t", element_type: "Type", building: "Building", level: "Level" };

export default function ComparePanel({ drawingId, revisions }: { drawingId: string; revisions: RevisionView[] }) {
  const router = useRouter();
  const feel = useFeel();
  const ordered = useMemo(() => [...revisions].sort((a, b) => b.rev_no - a.rev_no), [revisions]);
  const [to, setTo] = useState(ordered[0]?.id ?? "");
  const [from, setFrom] = useState("");
  const [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!to) return;
    setError(""); setData(null);
    const q = new URLSearchParams({ to }); if (from) q.set("from", from); if (all) q.set("unchanged", "1");
    const r = await call<Answer>(`/api/drawings/${drawingId}/compare?${q}`, "GET");
    if (r.ok) setData(r.data); else setError(r.error);
  }, [drawingId, to, from, all]);
  useEffect(() => { void load(); }, [load]);

  if (ordered.length < 2) return <EmptyState title="Nothing to compare yet" text="A comparison needs two revisions. It opens here when a new revision has elements." />;

  const toRev = ordered.find((r) => r.id === to);
  const rows = data?.comparison.rows.filter((r) => filter === "all" || r.kind === filter) ?? [];
  const counts = data?.comparison.counts;
  const t = data?.comparison.totals;

  async function act(kind: "release" | "return") {
    if (!toRev) return;
    if (kind === "release") {
      const ok = await feel.confirm({ title: `Release revision ${toRev.rev_label}?`, body: "It supersedes the revision released before it. This cannot be undone.", confirmLabel: "Release" });
      if (!ok) return;
    }
    setBusy(true);
    const r = await call(`/api/drawings/${drawingId}/revisions/${toRev.id}/${kind}`, "POST", kind === "return" ? { reason } : {});
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    feel.toast({ text: kind === "release" ? `Revision ${toRev.rev_label} released` : "Returned to draft", tone: "success" });
    setReturning(false);
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className={s.toolbar}>
        <label className="bpm-t-label" htmlFor="cmp-from">Compare</label>
        <Select id="cmp-to" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 200 }} aria-label="Newer revision">
          {ordered.map((r) => <option key={r.id} value={r.id}>{r.rev_label} ({STATUS_LABEL[r.status]})</option>)}
        </Select>
        <span className={s.quiet}>with</span>
        <Select id="cmp-from" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 220 }} aria-label="Older revision">
          <option value="">The release before it</option>
          {ordered.filter((r) => r.id !== to).map((r) => <option key={r.id} value={r.id}>{r.rev_label} ({STATUS_LABEL[r.status]})</option>)}
        </Select>
        <InfoTip label="Comparison">{DRAWING_TIPS.compare}</InfoTip>
      </div>

      {error && <div role="alert" className={s.alert}>{error}</div>}
      {!data && !error && <p className={s.quiet}>Comparing</p>}

      {data && !data.hasElements.to && <EmptyState title={`Revision ${data.to.rev_label} has no elements`} text="Load its element schedule in the Elements tab to see what changed." />}

      {data && data.hasElements.to && counts && t && (
        <>
          <div className={s.strip} data-guide="drawings.compare_summary">
            <StatTile label="Added" value={counts.added} tone={counts.added ? "good" : "neutral"} />
            <StatTile label="Removed" value={counts.removed} tone={counts.removed ? "bad" : "neutral"} />
            <StatTile label="Changed" value={counts.changed} tone={counts.changed ? "warn" : "neutral"} />
            <StatTile label="Unchanged" value={counts.unchanged} />
            {counts.notMatched > 0 && <StatTile label="Not matched" value={counts.notMatched} tone="warn" info="Elements with neither a model id nor a code. They are never guessed." />}
          </div>
          <Card title="Totals" padding={14}>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Building</th><th>Type</th><th className={s.num}>Pieces</th><th className={s.num}>Concrete m3</th><th className={s.num}>Weight t</th></tr></thead>
                <tbody>
                  {data.comparison.groups.filter((g) => g.count_from !== g.count_to || Math.abs(g.volume_from - g.volume_to) > 1e-6 || Math.abs(g.weight_from - g.weight_to) > 1e-6).map((g) => (
                    <tr key={g.key}><td>{g.building}</td><td>{g.element_type}</td>
                      <td className={s.num}><Delta a={g.count_from} b={g.count_to} /></td><td className={s.num}><Delta a={g.volume_from} b={g.volume_to} /></td><td className={s.num}><Delta a={g.weight_from} b={g.weight_to} /></td></tr>
                  ))}
                  <tr><td colSpan={2}><strong>All</strong></td><td className={s.num}><Delta a={t.count_from} b={t.count_to} /></td><td className={s.num}><Delta a={t.volume_from} b={t.volume_to} /></td><td className={s.num}><Delta a={t.weight_from} b={t.weight_to} /></td></tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Elements" padding={14}>
            <div className={s.toolbar}>
              <div className={s.seg} role="group" aria-label="Filter">
                {(["all", "added", "removed", "changed"] as Filter[]).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All changes" : f[0].toUpperCase() + f.slice(1)}</button>)}
              </div>
              {data.unchangedRows > 0 && <Button size="sm" variant="quiet" onClick={() => setAll((v) => !v)}>{all ? "Hide unchanged" : `Show unchanged (${data.unchangedRows})`}</Button>}
            </div>
            {rows.length === 0 ? <p className={s.quiet}>Nothing in this view.</p> : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th>Element</th><th>What changed</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 300).map((r) => (
                      <tr key={r.kind + r.key}>
                        <td><span className={r.kind === "added" ? s.added : r.kind === "removed" ? s.removed : r.kind === "changed" ? s.changed : undefined}>{r.kind === "added" ? "Added" : r.kind === "removed" ? "Removed" : r.kind === "changed" ? "Changed" : "Same"}</span>{" "}
                          {(r.kind === "removed" ? r.from : r.to).element_code ?? (r.kind === "removed" ? r.from : r.to).model_uid}</td>
                        <td>
                          {r.kind === "changed" ? r.changes.map((ch) => <div key={ch.field}>{FIELD_LABEL[ch.field]}: <span className={s.was}>{String(ch.from ?? "none")}</span>{String(ch.to ?? "none")}</div>)
                            : r.kind === "added" ? `${fmtNum(r.to.qty, 3)} pieces, ${r.to.element_type ?? ""}` : r.kind === "removed" ? `${fmtNum(r.from.qty, 3)} pieces, ${r.from.element_type ?? ""}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > 300 && <p className={s.quiet}>Showing the first 300 of {rows.length}. Filter to narrow it.</p>}
          </Card>

          <Card title="Effect on the bill of quantities" info={DRAWING_TIPS.effect} padding={14}>
            {data.effect.length === 0 ? <p className={s.quiet}>No tender line takes a quantity from this drawing yet.</p> : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th>Line</th><th>Code</th><th className={s.num}>Model qty now</th><th className={s.num}>Under {data.to.rev_label}</th></tr></thead>
                  <tbody>{data.effect.map((e) => (
                    <tr key={e.boq_id}><td>{e.item} {e.description}</td><td>{e.element_code}</td><td className={s.num}>{fmtNum(e.was, 3)}</td>
                      <td className={s.num}><Delta a={e.was} b={e.becomes} /></td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {toRev && toRev.status === "in_review" && (toRev.canRelease || toRev.canReturn) && (
        <Card padding={14}>
          <div className={s.actions}>
            {toRev.canRelease && <Button variant="primary" loading={busy} onClick={() => act("release")} data-guide="drawings.compare_release">Release revision {toRev.rev_label}</Button>}
            {toRev.canReturn && <Button onClick={() => setReturning((v) => !v)}>Return to draft</Button>}
          </div>
          {returning && (
            <div className={s.returnBox} style={{ marginTop: 10 }}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="What needs to change" aria-label="Reason for returning" />
              <div className={s.actions}><Button size="sm" variant="primary" disabled={!reason.trim()} loading={busy} onClick={() => act("return")}>Return</Button></div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Delta({ a, b }: { a: number; b: number }) {
  const d = Math.round((b - a) * 1000) / 1000;
  if (d === 0) return <>{fmtNum(b, 3)}</>;
  return <><span className={s.was}>{fmtNum(a, 3)}</span>{fmtNum(b, 3)} <span className={d > 0 ? s.added : s.removed}>({d > 0 ? "+" : ""}{fmtNum(d, 3)})</span></>;
}
