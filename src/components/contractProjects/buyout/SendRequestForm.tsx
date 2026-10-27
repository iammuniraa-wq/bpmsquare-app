"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import { loadPackageSuppliers, type ApiResult } from "./api";
import type { PickerList, PickerSupplier } from "./types";

// "Send request" for a package: the suppliers the client's approved list allows (the picker shows only those; the server refuses the rest
// and names them), a reply-by date and a note. One request goes to every ticked supplier and becomes a new round; earlier rounds stay.

const PAGE = 8;

/** The picker answers `{ restricted, suppliers }`; a bare list is read as unrestricted. */
export function readPicker(json: unknown): PickerList {
  if (Array.isArray(json)) return { restricted: false, suppliers: json as PickerSupplier[] };
  const j = (json ?? {}) as Partial<PickerList>;
  return { restricted: j.restricted === true, suppliers: Array.isArray(j.suppliers) ? j.suppliers : [], group: j.group ?? null };
}

export default function SendRequestForm({ projectId, packageId, groupName, nextRound, busy, error, onSend, onCancel, initialPicker }: {
  projectId: string;
  packageId: string;
  /** The project's approved group, for the note when the picker says it is restricted. */
  groupName: string | null;
  /** 1 for the first request, 2 for a re-quote, and so on. */
  nextRound: number;
  busy: boolean;
  error: string;
  onSend: (body: { supplier_ids: string[]; reply_by?: string; note?: string }) => void;
  onCancel: () => void;
  /** Lets a server render (and its test) show the loaded picker. The page never passes it. */
  initialPicker?: PickerList;
}) {
  const [picker, setPicker] = useState<PickerList | null>(initialPicker ?? null);
  const [loadError, setLoadError] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [replyBy, setReplyBy] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (initialPicker) return;
    let live = true;
    void loadPackageSuppliers<unknown>(projectId, packageId).then((r: ApiResult<unknown>) => {
      if (!live) return;
      if (!r.ok) { setLoadError(r.json.error ?? "Could not load the suppliers"); setPicker({ restricted: false, suppliers: [] }); return; }
      setPicker(readPicker(r.json));
    });
    return () => { live = false; };
  }, [initialPicker, projectId, packageId]);

  const list = picker?.suppliers ?? [];
  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return t ? list.filter((s) => `${s.name} ${s.city ?? ""} ${s.email ?? ""}`.toLowerCase().includes(t)) : list;
  }, [list, filter]);
  const visible = showAll || filter ? shown : shown.slice(0, PAGE);
  const toggle = (id: string) => setChosen((cs) => (cs.includes(id) ? cs.filter((x) => x !== id) : [...cs, id]));
  const noEmail = chosen.filter((id) => !list.find((s) => s.id === id)?.email).length;
  const name = picker?.group?.name ?? groupName;

  return (
    <div data-guide="buyout.send" className="bpm-tap" style={{ display: "flex", flexDirection: "column", gap: 10, border: `1px solid ${c.line}`, borderRadius: 8, padding: 12 }}>
      <b style={{ fontSize: 13, color: c.ink }}>{nextRound > 1 ? `Request, round ${nextRound}` : "Request"}</b>
      {picker && (
        <div data-guide="buyout.send.source" role="status" style={{ fontSize: 12.5, color: c.muted }}>
          {picker.restricted ? <>Suppliers from: <b style={{ color: c.ink }}>{name ?? "the client's approved list"}</b></> : "No approved list for this client"}
        </div>
      )}
      {loadError && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{loadError}</div>}
      {!picker ? (
        <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading the suppliers…</div>
      ) : (
        <>
          {list.length > PAGE && <Input aria-label="Search suppliers" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search suppliers…" />}
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 8 }}>
            {visible.map((s) => (
              <label key={s.id} data-guide="buyout.send.supplier" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", minHeight: 44, borderBottom: `1px solid ${c.line}`, cursor: "pointer", fontSize: 13, color: c.ink }}>
                <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} style={{ width: 20, height: 20, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{s.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: c.hint }}>{[s.city, s.email ?? "no email"].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            ))}
            {visible.length === 0 && (
              <div style={{ padding: 12, fontSize: 12.5, color: c.hint }}>{list.length === 0 ? (picker.restricted ? "The approved list has no suppliers yet. Add them under Suppliers, Groups." : "No suppliers yet. Add them under Suppliers.") : "No suppliers match."}</div>
            )}
          </div>
          {!filter && shown.length > PAGE && (
            <div><Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="buyout.send.show_all" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${shown.length}`}</Button></div>
          )}
          {noEmail > 0 && <div role="status" style={{ fontSize: 12, color: "var(--amberink)" }}>{noEmail} chosen supplier{noEmail === 1 ? " has" : "s have"} no email. Send the reply link on WhatsApp from the RFQ.</div>}
          <Field label="Reply by" guide="buyout.send.field.reply_by" style={{ marginBottom: 0 }}><Input type="date" value={replyBy} onChange={(e) => setReplyBy(e.target.value)} /></Field>
          <Field label="Note to suppliers" guide="buyout.send.field.note" style={{ marginBottom: 0 }}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
        </>
      )}
      {error && <div role="alert" data-guide="buyout.send.error" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" loading={busy} disabled={busy || chosen.length === 0} style={{ minHeight: 44 }} data-guide="buyout.send.submit"
          onClick={() => onSend({ supplier_ids: chosen, ...(replyBy ? { reply_by: replyBy } : {}), ...(note.trim() ? { note: note.trim() } : {}) })}>
          Send request to {chosen.length || ""} supplier{chosen.length === 1 ? "" : "s"}
        </Button>
        <Button variant="secondary" disabled={busy} style={{ minHeight: 44 }} data-guide="buyout.send.cancel" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
