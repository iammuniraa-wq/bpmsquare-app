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
  objectType, objectId, changeLogType, isAdmin,
}: {
  /** The Nova timeline object type (see OBJECTS in api/nova/comments). */
  objectType: string;
  objectId: string;
  /** change_log.object_type when it differs from objectType. */
  changeLogType?: string;
  isAdmin: boolean;
}) {
  const nova = useNovaSurfaces();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [done, setDone] = useState(!isAdmin);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    const qs = new URLSearchParams({ object_type: changeLogType ?? objectType, object_id: objectId, limit: "50" });
    fetch(`/api/change-log?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setRows(j?.rows ?? null); })
      .catch(() => {})
      .finally(() => { if (live) setDone(true); });
    return () => { live = false; };
  }, [isAdmin, objectType, objectId, changeLogType]);

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
                  {r.actor_email ? `${r.actor_email} · ` : ""}
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
