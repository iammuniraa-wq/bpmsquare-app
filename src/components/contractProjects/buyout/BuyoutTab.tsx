"use client";

import { useState } from "react";
import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import StatusPill from "@/components/ui/StatusPill";
import { money } from "@/lib/contractProjects/format";
import { useReloaded } from "../useReloaded";
import { buyoutUrl } from "./api";
import NewPackagePanel from "./NewPackagePanel";
import PackagePanel from "./PackagePanel";
import { applyFilter, againstText, FILTER_LABEL, FILTERS, filterCounts, HANDOVER_LABEL, HANDOVER_TONE, STATUS_TONE, statusText, tileSubs, type BuyoutFilter } from "./rules";
import { BUYOUT_TIPS } from "./tips";
import { KIND_LABEL, type BuyoutData, type PackageRow } from "./types";

// The Buy-out tab of a contract project made from a tender: after the award, who supplies each package, from the client's approved suppliers.
// A line for the approved group, four tiles, filters, one table of packages (cards under 780 px), and the side panel for one package. Purchase
// orders stay in ePROMIS or the ERP: this screen decides, records and hands over. Every change re-reads the tab's data and refreshes the page
// (useReloaded), so the tiles and chips never go stale.

const PAGE = 10;
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "9px 12px", background: c.panel2, fontWeight: 600 };
const num: React.CSSProperties = { padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, whiteSpace: "nowrap" };
const toneInk = { good: pillar.teal.fg, bad: pillar.red.fg, none: c.muted } as const;

export default function BuyoutTab({ projectId, data: fromServer, currency, canEdit, initialPanel, initialFilter }: {
  projectId: string;
  data: BuyoutData;
  currency: string | null;
  /** Whether the person may change packages: false for a view-only person or a closed project. */
  canEdit: boolean;
  /** Let a server render (and its test) show the tab with a panel open or a filter set. The page never passes them. */
  initialPanel?: { id: string } | "new";
  initialFilter?: BuyoutFilter;
}) {
  // Every change reloads the list and the tiles here, then refreshes the page.
  const { data, reload } = useReloaded<BuyoutData>(buyoutUrl(projectId), fromServer);
  const [panel, setPanel] = useState<{ id: string } | "new" | null>(initialPanel ?? null);
  const [filter, setFilter] = useState<BuyoutFilter>(initialFilter ?? "all");
  const [showAll, setShowAll] = useState(false);

  if (data.pending) {
    return <div role="alert" data-guide="buyout.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Buy-out needs a database update. Ask your administrator to apply it.</div>;
  }

  const counts = filterCounts(data.packages);
  const filtered = applyFilter(data.packages, filter);
  const list = showAll ? filtered : filtered.slice(0, PAGE);
  const subs = tileSubs(data, currency);
  const t = data.tiles;
  const open = panel && panel !== "new" ? data.packages.find((p) => p.id === panel.id) : undefined;
  const changed = () => { void reload(); };
  const empty = data.packages.length === 0;

  const openRow = (p: PackageRow) => setPanel({ id: p.id });

  return (
    <div className="bpm-tap" data-guide="buyout" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div data-guide="buyout.group" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: c.muted }}>
        {data.group ? <><span>Suppliers from:</span><StatusPill label={data.group.name} tone="blue" /></> : <span>No approved list for this client</span>}
        <InfoTip label="Approved suppliers">{BUYOUT_TIPS.group}</InfoTip>
      </div>

      <StatStrip guide="buyout.kpis">
        <StatTile tone="neutral" label="Budget in packages" info={BUYOUT_TIPS.budget} value={money(t.budget, currency)} sub={subs.budget} />
        <StatTile tone={subs.committedTone} label="Committed" info={BUYOUT_TIPS.committed} value={money(t.committed, currency)} sub={subs.committed} />
        <StatTile tone={subs.bestTone} label="Best quotes vs budget" info={BUYOUT_TIPS.bestVsBudget} value={subs.bestValue} sub={subs.best} />
        <StatTile tone={t.needs_decision > 0 ? "warn" : "neutral"} label="Needs a decision" info={BUYOUT_TIPS.needsDecision} value={String(t.needs_decision)} sub={subs.decision} />
      </StatStrip>

      <div data-guide="buyout.filters" role="group" aria-label="Filter packages" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f} type="button" aria-pressed={filter === f} data-guide={`buyout.filter.${f}`} onClick={() => { setFilter(f); setShowAll(false); }}
            style={{
              minHeight: 44, padding: "0 14px", borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 13,
              border: `1px solid ${filter === f ? c.accent : c.line}`, background: filter === f ? c.accentbg : "var(--card-bg)", color: filter === f ? c.accent : c.ink, fontWeight: filter === f ? 600 : 400,
            }}
          >
            {FILTER_LABEL[f]} <span style={{ opacity: 0.75, marginLeft: 4 }}>{counts[f]}</span>
          </button>
        ))}
      </div>

      <Card
        title="Packages" info={BUYOUT_TIPS.tab} padding={0}
        action={canEdit ? <Button variant="primary" size="sm" data-guide="buyout.package.new" style={{ minHeight: 44 }} onClick={() => setPanel("new")}>+ New package</Button> : undefined}
      >
        {empty ? (
          <EmptyState
            title="No packages yet"
            text={data.unassigned_lines.length > 0 ? "Group budget lines into packages, then ask the client's approved suppliers for one price per package." : "Add budget lines on the Budget tab first, then group them into packages here."}
            action={canEdit && data.unassigned_lines.length > 0 ? <Button variant="primary" style={{ minHeight: 44 }} data-guide="buyout.empty.new" onClick={() => setPanel("new")}>+ New package</Button> : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No packages in this view" text="Pick another filter to see the rest." />
        ) : (
          <>
            <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
              <table data-guide="buyout.table" style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Package</th>
                    <th style={{ ...th, textAlign: "right" }}>Budget</th><th style={{ ...th, textAlign: "right" }}>Best quote</th><th style={{ ...th, textAlign: "right" }}>Committed</th><th style={{ ...th, textAlign: "right" }}>Against budget</th>
                    <th style={th}>Status</th><th style={th}>ePROMIS</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const a = againstText(p, currency);
                    return (
                      <tr key={p.id} data-guide="buyout.row" onClick={() => openRow(p)} style={{ borderTop: `1px solid ${c.line}`, cursor: "pointer" }}>
                        <td style={{ padding: 0 }}>
                          <button type="button" data-guide="buyout.package.open" aria-label={`Open package ${p.name}`} onClick={() => openRow(p)}
                            style={{ all: "unset", boxSizing: "border-box", display: "block", width: "100%", minHeight: 52, padding: "8px 12px", cursor: "pointer" }}>
                            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{p.name}</span>
                            <span style={{ display: "block", fontSize: 12, color: c.hint }}>{[`${p.line_count} line${p.line_count === 1 ? "" : "s"}`, KIND_LABEL[p.kind], p.ref].filter(Boolean).join(" · ")}</span>
                          </button>
                        </td>
                        <td style={num}>{money(p.budget, currency)}</td>
                        <td style={num}>{money(p.best_quote, currency)}</td>
                        <td style={num}>{money(p.committed, currency)}</td>
                        <td style={{ ...num, color: toneInk[a.tone], fontWeight: a.tone === "none" ? 400 : 600 }}>{a.text}</td>
                        <td style={{ padding: "8px 12px" }}><StatusPill label={statusText(p)} tone={STATUS_TONE[p.status]} /></td>
                        <td style={{ padding: "8px 12px" }}><StatusPill label={HANDOVER_LABEL[p.handover.state]} tone={HANDOVER_TONE[p.handover.state]} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bpm-rows-cards" data-guide="buyout.cards" style={{ gap: 10, padding: 12 }}>
              {list.map((p) => {
                const a = againstText(p, currency);
                return (
                  <button key={p.id} type="button" data-guide="buyout.card" aria-label={`Open package ${p.name}`} onClick={() => openRow(p)}
                    style={{ all: "unset", boxSizing: "border-box", display: "block", width: "100%", minHeight: 44, padding: 12, cursor: "pointer", border: `1px solid ${c.line}`, borderRadius: 12, background: "var(--card-bg)" }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{p.name}</span>
                        <span style={{ display: "block", fontSize: 12, color: c.hint }}>{[`${p.line_count} line${p.line_count === 1 ? "" : "s"}`, KIND_LABEL[p.kind], p.ref].filter(Boolean).join(" · ")}</span>
                      </span>
                      <StatusPill label={statusText(p)} tone={STATUS_TONE[p.status]} />
                    </span>
                    <CardRow label="Budget" value={money(p.budget, currency)} />
                    <CardRow label="Best quote" value={money(p.best_quote, currency)} />
                    {p.committed != null && <CardRow label="Committed" value={money(p.committed, currency)} />}
                    <CardRow label="Against budget" value={a.text} ink={toneInk[a.tone]} />
                  </button>
                );
              })}
            </div>
          </>
        )}
        {filtered.length > PAGE && (
          <div style={{ padding: "8px 12px", borderTop: `1px solid ${c.line}` }}>
            <Button variant="quiet" size="sm" data-guide="buyout.show_all" style={{ minHeight: 44 }} onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${filtered.length}`}</Button>
          </div>
        )}
      </Card>

      {panel === "new" && (
        <NewPackagePanel
          projectId={projectId} lines={data.unassigned_lines} currency={currency} onClose={() => setPanel(null)}
          onCreated={(created) => { setPanel(created?.id ? { id: created.id } : null); changed(); }}
        />
      )}
      {open && (
        <PackagePanel
          key={open.id} projectId={projectId} row={open} currency={currency} canEdit={canEdit} groupName={data.group?.name ?? null}
          onClose={() => setPanel(null)} onChanged={changed}
        />
      )}
    </div>
  );
}

function CardRow({ label, value, ink }: { label: string; value: string; ink?: string }) {
  return (
    <span style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6, fontSize: 13 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <b style={{ color: ink ?? c.ink, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{value}</b>
    </span>
  );
}
