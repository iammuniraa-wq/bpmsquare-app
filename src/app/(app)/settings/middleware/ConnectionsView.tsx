"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import MoreMenu from "@/components/ui/MoreMenu";
import { useFeel } from "@/components/FeelProvider";
import type { PublicConnection } from "@/lib/connections/spec";
import { CONNECTION_TIPS } from "@/lib/connections/tips";
import s from "./middleware.module.css";
import { deleteCustomConnection, testCustomConnection, type ConnectionItem, type CustomConnectionList } from "./api";
import type { Piece } from "./context";
import { ago, buildConnectionRows, type ConnectionRow } from "./customConnectionLogic";
import ConnectionSheet from "./ConnectionSheet";
import EndpointsPanel from "./EndpointsPanel";
import { PlusIcon, Notice, ProblemNotice, describeError, useFlash } from "./ui";

// Connections: ONE table. First your ERP connectors (unchanged: their own panel sits behind their chip), then the connections you
// add yourself. Add connection opens a side panel with three steps; Test, Edit and Disconnect are the row actions.
// A workspace with no connection of its own sees the table of its ERP connectors only.

export default function ConnectionsView({ existing, list, onOpenExisting }: {
  existing: readonly ConnectionItem[];
  /** Loaded by the page, so the chip's count and this table agree. */
  list: Piece<CustomConnectionList>;
  onOpenExisting: (id: string) => void;
}) {
  const { confirm } = useFeel();
  const [sheet, setSheet] = useState<{ initial: PublicConnection | null } | null>(null);
  const [endpointsOf, setEndpointsOf] = useState<string | null>(null);
  const onOpenEndpoints = (c: PublicConnection) => setEndpointsOf(c.id);
  const endpointsFor = list.data?.connections.find((c) => c.id === endpointsOf) ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const { flash, show } = useFlash();

  const pending = list.data?.needsDatabaseUpdate === true;
  const rows = buildConnectionRows(existing, list.data?.connections ?? []);

  const test = async (r: ConnectionRow) => {
    if (!r.custom) return;
    setBusy(r.key);
    try {
      const out = await testCustomConnection(r.custom.id);
      show(out.result.ok, out.result.ok ? `${r.name}: ${out.result.message}` : `${r.name}: ${out.result.message} ${out.result.fix ?? ""}`.trim());
      await list.reload();
    } catch (e) { show(false, describeError(e)); } finally { setBusy(null); }
  };

  const remove = async (r: ConnectionRow) => {
    if (!r.custom) return;
    const n = r.custom.endpointCount;
    if (!(await confirm({
      title: `Disconnect ${r.name}?`,
      body: n > 0 ? `Its ${n} endpoint${n === 1 ? "" : "s"} and the stored sign-in are removed. Records already brought in stay in BPMSquare.` : "The stored sign-in is removed. Records already brought in stay in BPMSquare.",
      confirmLabel: "Disconnect", tone: "danger",
    }))) return;
    setBusy(r.key);
    try { await deleteCustomConnection(r.custom.id); show(true, `${r.name} disconnected.`); await list.reload(); }
    catch (e) { show(false, describeError(e)); } finally { setBusy(null); }
  };

  if (list.error != null && !list.data) return <ProblemNotice error={list.error} onRetry={() => void list.reload()} />;

  return (
    <>
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      <div className={s.rowBetween}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">Connections</h2><InfoTip label="Connections">{CONNECTION_TIPS.section}</InfoTip></span>
        <Button variant="primary" size="sm" icon={<PlusIcon />} data-guide="connections.add" disabled={pending || !list.data} onClick={() => setSheet({ initial: null })}>Add connection</Button>
      </div>
      {pending && (
        <Notice tone="info" action={<InfoTip label="Database update">{CONNECTION_TIPS.needsUpdate}</InfoTip>}>
          An update is needed before you can add connections.
        </Notice>
      )}

      <div className={s.listCard} data-guide="connections.table">
        {rows.length === 0 ? (
          <EmptyState
            title="No connections yet" text="Add a REST API or an OData service. It takes a minute."
            action={pending ? undefined : <Button variant="primary" onClick={() => setSheet({ initial: null })}>Add connection</Button>}
          />
        ) : (
          <table className={`${s.docTable} ${s.connTable}`}>
            <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Last test</th><th><span className="bpm-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={s.docRow}>
                  <td className={s.connName} data-label="Name">
                    {r.kind === "custom"
                      ? <button type="button" className={s.docOpen} data-guide="connections.row" onClick={() => onOpenEndpoints(r.custom!)} aria-label={`${r.name}: endpoints`}><span className={s.fieldName}>{r.name}</span></button>
                      : <span className={s.fieldName}>{r.name}</span>}
                    {r.detail && r.status !== "ok" && r.status !== "connected" ? <span className={s.connDetail}>{r.detail}</span> : null}
                  </td>
                  <td data-label="Type">{`${r.type}${r.endpoints !== null ? ` · ${r.endpoints} endpoint${r.endpoints === 1 ? "" : "s"}` : ""}`}</td>
                  <td className={s.connStatus} data-label="Status">
                    <span className={`${s.statusChip} ${r.status === "ok" || r.status === "connected" ? s.statusOk : r.status === "failed" || r.status === "attention" ? s.statusBad : ""}`}>
                      <span className={`${s.dot} ${r.status === "ok" || r.status === "connected" ? s.dotOn : r.status === "failed" || r.status === "attention" ? s.dotWarn : ""}`} aria-hidden="true" />
                      {r.statusText}
                    </span>
                  </td>
                  <td data-label="Last test">{r.kind === "custom" ? (ago(r.testedAt) || "Never") : ""}</td>
                  <td className={s.connActions}>
                    {r.kind === "existing" ? (
                      <Button size="sm" onClick={() => onOpenExisting(r.existingId!)} aria-label={`Open ${r.name}`}>Open</Button>
                    ) : (
                      <span className={`${s.row} bpm-tap`} style={{ justifyContent: "flex-end" }}>
                        <Button size="sm" data-guide="connections.row.test" onClick={() => void test(r)} loading={busy === r.key} disabled={busy !== null}>Test</Button>
                        <MoreMenu label={`More for ${r.name}`} items={[
                          { label: "Endpoints", onSelect: () => onOpenEndpoints(r.custom!) },
                          { label: "Edit", onSelect: () => setSheet({ initial: r.custom! }) },
                          { label: "Disconnect", onSelect: () => void remove(r), danger: true },
                        ]} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {endpointsFor && <EndpointsPanel key={endpointsFor.id} connection={endpointsFor} onClose={() => setEndpointsOf(null)} onChanged={() => list.reload()} />}

      {sheet && (
        <ConnectionSheet
          key={sheet.initial?.id ?? "new"} initial={sheet.initial} onClose={() => setSheet(null)}
          onSaved={async () => { await list.reload(); show(true, "Saved."); }}
        />
      )}
    </>
  );
}
