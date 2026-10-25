"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { Select, Textarea } from "@/components/ui/Input";
import { ROUTES } from "@/lib/constants";
import { day, money, pct } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { JUSTIFICATION_NEEDS_NOTE, REVISION_STATUS_LABEL } from "@/lib/contractProjects/types";
import type { ProjectView } from "@/lib/contractProjects/view";

const tone = (s: string) => (s === "approved" ? "green" : s === "pending" ? "amber" : s === "superseded" ? "teal" : "blue") as "green" | "amber" | "teal" | "blue";
const MAX_SHOWN = 40;

/** The revisions of a project, the way to start the next one (with its reason), and what the one being looked at changed. */
export default function RevisionsPanel({ view }: { view: ProjectView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const { project: p, revisions, revision, compare } = view;
  const cur = p.currency;
  const justName = new Map(view.justifications.map((j) => [j.code, j.name]));
  const hasApproved = revisions.some((r) => r.status === "approved");
  const hasOpen = revisions.some((r) => r.status === "draft" || r.status === "pending");
  const canStart = view.canEdit && hasApproved && !hasOpen && p.status !== "closed";

  function start() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/contract-projects/${p.id}/revisions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ justification_code: code, justification_text: note }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not start the revision"); return; }
      setCode(""); setNote("");
      router.push(`${ROUTES.contractProject(p.id)}?tab=budget&revision=${j.id}`);
    });
  }

  const diff = compare?.diff;
  return (
    <div data-guide="cp.revisions" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card title="Revisions" info={PROJECT_TIPS.revisions} padding={0}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Revision", "Status", "Reason", "Total", "Made", "Approved", ""].map((h) => <th key={h} style={{ textAlign: h === "Total" ? "right" : "left", fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "9px 12px", background: c.panel2, fontWeight: 600 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[...revisions].reverse().map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${c.line}`, background: revision?.id === r.id ? c.accentbg : undefined }}>
                  <td style={{ padding: "10px 12px", fontSize: 13.5, fontWeight: 600, color: c.ink }}>{r.rev_no === 0 ? "Baseline" : `Revision ${r.rev_no}`}</td>
                  <td style={{ padding: "10px 12px" }}><StatusPill label={REVISION_STATUS_LABEL[r.status]} tone={tone(r.status)} /></td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: c.muted, maxWidth: 260 }}>{r.rev_no === 0 ? "—" : [justName.get(r.justification_code ?? "") ?? r.justification_code, r.justification_text].filter(Boolean).join(": ") || "—"}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{money(r.total, cur)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12.5, color: c.muted }}>{[r.created_by_name, day(r.created_at)].filter((x) => x && x !== "—").join(" · ")}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12.5, color: c.muted }}>{r.approved_at ? [r.approved_by_name, day(r.approved_at)].filter(Boolean).join(" · ") : "—"}</td>
                  <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
                    <Link href={`${ROUTES.contractProject(p.id)}?tab=revisions&revision=${r.id}`} data-guide="cp.revisions.compare" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 8px", color: c.accent, fontSize: 13 }}>Changes</Link>
                    <Link href={`${ROUTES.contractProject(p.id)}?tab=budget&revision=${r.id}`} data-guide="cp.revisions.open" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 8px", color: c.accent, fontSize: 13 }}>Open</Link>
                  </td>
                </tr>
              ))}
              {revisions.length === 0 && <tr><td colSpan={7} style={{ padding: 16, fontSize: 13, color: c.hint }}>No budget yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {canStart && (
        <Card title="Start a revision" info={PROJECT_TIPS.justification} padding={16}>
          <div data-guide="cp.revisions.start" style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
            <Select aria-label="Reason for the revision" data-guide="cp.revisions.reason" value={code} style={{ minHeight: 44 }} onChange={(e) => setCode(e.target.value)}>
              <option value="">— Why is the budget changing? —</option>
              {view.justifications.map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}
            </Select>
            <Textarea rows={2} aria-label="Note" placeholder={code === JUSTIFICATION_NEEDS_NOTE ? "What changed (required)" : "Note (optional)"} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            <div><Button variant="primary" loading={pending} disabled={!code} data-guide="cp.revisions.start_button" style={{ minHeight: 44 }} onClick={start}>Start revision</Button></div>
            {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
          </div>
        </Card>
      )}

      {revision && diff && compare && (
        <Card title={`${revision.rev_no === 0 ? "Baseline" : `Revision ${revision.rev_no}`} against ${compare.against.rev_no === 0 ? "the baseline" : `revision ${compare.against.rev_no}`}`} info={PROJECT_TIPS.diff} padding={16}>
          <div data-guide="cp.revisions.diff" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14, color: c.ink }}>
              {money(diff.totalBefore, cur)} → <strong>{money(diff.totalAfter, cur)}</strong>{" "}
              <span style={{ color: diff.delta > 0 ? "var(--redink)" : diff.delta < 0 ? "var(--greenink)" : c.hint }}>({diff.delta > 0 ? "+" : ""}{money(diff.delta, cur)}{diff.deltaPct !== null ? ` · ${pct(diff.deltaPct)}` : ""})</span>
            </div>
            <div style={{ fontSize: 12.5, color: c.hint }}>{diff.added.length} added · {diff.removed.length} removed · {diff.changed.length} changed · {diff.unchanged} unchanged</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {diff.added.slice(0, MAX_SHOWN).map((l) => <li key={`a${l.line_key}`} style={{ fontSize: 13, color: "var(--greenink)" }}>+ {l.description} · {money(l.amount, cur, 2)}</li>)}
              {diff.removed.slice(0, MAX_SHOWN).map((l) => <li key={`r${l.line_key}`} style={{ fontSize: 13, color: "var(--redink)" }}>− {l.description} · {money(l.amount, cur, 2)}</li>)}
              {diff.changed.slice(0, MAX_SHOWN).map((ch) => (
                <li key={`c${ch.line_key}`} style={{ fontSize: 13, color: c.ink }}>
                  ~ {ch.after.description}: {ch.fields.map((f) => `${f.replace("_", " ")} ${String(ch.before[f] ?? "—")} → ${String(ch.after[f] ?? "—")}`).join("; ")}
                </li>
              ))}
            </ul>
            {diff.added.length + diff.removed.length + diff.changed.length > MAX_SHOWN && <div style={{ fontSize: 12, color: c.hint }}>Showing the first {MAX_SHOWN} of each kind.</div>}
          </div>
        </Card>
      )}
    </div>
  );
}
