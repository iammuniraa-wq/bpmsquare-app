"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import NovaTimelineSlot from "@/components/NovaTimelineSlot";
import { useNovaSurfaces } from "@/lib/tenant-context";

type Row = {
  id: string;
  action: "create" | "update" | "delete" | "reopen";
  changes: { field: string; from: unknown; to: unknown }[];
  actor_email: string | null;
  actor_name?: string | null;
  created_at: string;
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function summary(r: Row): string {
  if (r.action === "create") return "Record created";
  if (r.action === "delete") return "Record deleted";
  if (r.changes.length === 0) return r.action === "reopen" ? "Reopened" : "—";
  return r.changes.map((ch) => `${ch.field}: ${show(ch.from)} → ${show(ch.to)}`).join("; ");
}

/**
 * A record's Activity tab: the Nova comment timeline (it gates itself) plus
 * the change history for admins. The history comes from the same endpoint
 * the Change History page reads, which is admin- and feature-gated on the
 * server -- a refusal just means the card is not shown. When neither source
 * has anything to show the tab says so instead of being blank.
 */
export default function RecordActivity({
  objectType, objectId, changeLogType, extraChangeLogTypes, isAdmin,
}: {
  /** The Nova timeline object type (see OBJECTS in api/nova/comments). */
  objectType: string;
  objectId: string;
  /** change_log.object_type when it differs from objectType. */
  changeLogType?: string;
  /** More change_log.object_type values whose entries for the same id belong in this history (a deal's tender details). */
  extraChangeLogTypes?: string[];
  isAdmin: boolean;
}) {
  const nova = useNovaSurfaces();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [done, setDone] = useState(!isAdmin);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    const types = [changeLogType ?? objectType, ...(extraChangeLogTypes ?? [])];
    Promise.all(types.map((t) => {
      const qs = new URLSearchParams({ object_type: t, object_id: objectId, limit: "50" });
      return fetch(`/api/change-log?${qs}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    }))
      .then((all) => {
        if (!live) return;
        // A refusal on every type means "not shown" (as before); otherwise the entries of all types, newest first.
        if (all.length === 1) { setRows(all[0]?.rows ?? null); return; }
        const merged = all.flatMap((j) => (j?.rows ?? []) as Row[]);
        setRows(all.every((j) => j === null) ? null : merged.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50));
      })
      .finally(() => { if (live) setDone(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, objectType, objectId, changeLogType, (extraChangeLogTypes ?? []).join("|")]);

  const history = rows && rows.length > 0 ? rows : null;
  if (!nova && done && !history) {
    return (
      <Card>
        <EmptyState title="No activity yet" text="Changes and comments on this record will appear here." />
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <NovaTimelineSlot objectType={objectType} objectId={objectId} />
      {history && (
        <Card title="Change history">
          {history.map((r, i) => (
            <div key={r.id} style={{ padding: "9px 0", borderTop: i === 0 ? "none" : `1px solid ${c.line}`, fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", color: c.hint }}>
                <span style={{ textTransform: "capitalize", fontWeight: 600, color: c.muted }}>{r.action}</span>
                <span>
                  {r.actor_name || r.actor_email ? `${r.actor_name || r.actor_email?.split("@")[0]} · ` : ""}
                  {new Date(r.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div style={{ color: c.ink, marginTop: 3, wordBreak: "break-word" }}>{summary(r)}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
