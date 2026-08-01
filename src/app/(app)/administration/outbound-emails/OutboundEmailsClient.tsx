"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { csvCell, downloadCsv } from "@/lib/import/template";

const KINDS: { value: string; label: string }[] = [
  { value: "", label: "All channels" },
  { value: "quote", label: "Quote emails" },
  { value: "campaign", label: "Campaign sends" },
];

type EmailLogRow = {
  id: string;
  kind: "quote" | "campaign";
  to_email: string;
  subject: string;
  status: "sent" | "failed";
  error: string | null;
  related_object_type: string | null;
  related_object_id: string | null;
  related_object_label: string | null;
  actor_email: string | null;
  created_at: string;
};

const STATUS_TONE: Record<EmailLogRow["status"], { bg: string; fg: string }> = {
  sent: { bg: "#e5f6ee", fg: "#1c8a5a" },
  failed: { bg: "#fbe9e7", fg: "#c62828" },
};

const KIND_LABEL: Record<EmailLogRow["kind"], string> = {
  quote: "Quote",
  campaign: "Campaign",
};

export default function OutboundEmailsClient() {
  const [kind, setKind] = useState("");
  const [relatedObjectId, setRelatedObjectId] = useState("");
  const [rows, setRows] = useState<EmailLogRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (relatedObjectId.trim()) params.set("related_object_id", relatedObjectId.trim());
      const res = await fetch(`/api/email-log?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Search failed (${res.status})`);
        setRows(null);
        return;
      }
      setRows(json.rows as EmailLogRow[]);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!rows || rows.length === 0) return;
    const header = ["Date", "Channel", "To", "Subject", "Status", "Error", "Record", "Sent by"];
    const body = rows.map((r) =>
      [
        r.created_at, KIND_LABEL[r.kind], r.to_email, r.subject, r.status,
        r.error ?? "", r.related_object_label ?? "", r.actor_email ?? "",
      ]
        .map((v) => csvCell(String(v)))
        .join(",")
    );
    const csv = "﻿" + [header.join(","), ...body].join("\r\n") + "\r\n";
    const label = KINDS.find((k) => k.value === kind)?.label ?? "all";
    downloadCsv(`outbound_emails_${label.toLowerCase().replace(/\s+/g, "_")}${relatedObjectId ? `_${relatedObjectId}` : ""}.csv`, csv);
  }

  const visible = rows?.slice(0, 300) ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
            Channel
          </label>
          <select
            value={kind}
            onChange={(e) => { setKind(e.target.value); setRows(null); }}
            style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, background: c.panel, color: c.ink, minWidth: 180 }}
          >
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
            Record ID (optional)
          </label>
          <input
            value={relatedObjectId}
            onChange={(e) => setRelatedObjectId(e.target.value)}
            placeholder="Quote or campaign ID"
            style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, background: c.panel, color: c.ink, minWidth: 260 }}
          />
        </div>
        <button
          onClick={search}
          disabled={loading}
          style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: c.accent, color: c.panel, border: "none", cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
        {rows && rows.length > 0 && (
          <button
            onClick={download}
            style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}
          >
            ↓ Download CSV
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: "#fbe9e7", border: "1px solid #c6282840", borderRadius: 10, padding: "13px 16px", fontSize: 12.5, color: "#c62828" }}>
          {error}
        </div>
      )}

      {rows && (
        <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 9 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["When", "Channel", "To", "Subject", "Status", "Record", "Sent by"].map((h) => (
                  <th key={h} style={{ padding: "9px 11px", textAlign: "left", color: c.hint, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${c.line}`, background: c.panel2, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const tone = STATUS_TONE[row.status];
                return (
                  <tr key={row.id}>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.hint, whiteSpace: "nowrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.ink, whiteSpace: "nowrap" }}>
                      {KIND_LABEL[row.kind]}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.ink }}>
                      {row.to_email}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.ink, maxWidth: 320 }}>
                      {row.subject}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap" }}>
                        {row.status}
                      </span>
                      {row.status === "failed" && row.error && (
                        <span style={{ display: "block", fontSize: 11, color: c.hint, marginTop: 3 }}>{row.error}</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.ink, whiteSpace: "nowrap" }}>
                      {row.related_object_label ?? row.related_object_id ?? "—"}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.muted, whiteSpace: "nowrap" }}>
                      {row.actor_email ?? "—"}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "20px 11px", textAlign: "center", color: c.hint }}>
                    No emails recorded yet for this {relatedObjectId ? "record" : "channel"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length > visible.length && (
        <div style={{ fontSize: 11.5, color: c.hint }}>
          Showing the first {visible.length} of {rows.length} entries — the CSV download includes all of them.
        </div>
      )}
    </div>
  );
}
