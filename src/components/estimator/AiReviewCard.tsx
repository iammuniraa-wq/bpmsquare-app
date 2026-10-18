"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import type { ReviewResult } from "@/lib/estimator/ai";

const KIND: Record<string, string> = { risk: "Risk", missing: "Missing", check: "Check" };

/** An AI second opinion on the stored estimate, in words. Shown, never saved. */
export default function AiReviewCard({ estimateId }: { estimateId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [review, setReview] = useState<ReviewResult | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/estimates/${estimateId}/ai/review`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503 && json.configured === false) { setNotConfigured(true); return; }
      if (!res.ok) { setError(json.error ?? "Could not review the estimate."); return; }
      setReview(json as ReviewResult);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="AI review" padding={18}
      action={!notConfigured ? <Button size="sm" variant="secondary" loading={busy} disabled={busy} onClick={run}>{review ? "Review again" : "Review this estimate"}</Button> : undefined}>
      {notConfigured ? (
        <div role="status" className="bpm-t-body">AI is not set up for this workspace.</div>
      ) : !review && !error ? (
        <div className="bpm-t-help">Ask for risks and missing items. Only quantities, groups and totals are sent, not unit costs. The answer is a suggestion and is not saved.</div>
      ) : null}
      {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13 }}>{error}</div>}
      {review && (
        <div aria-live="polite">
          {review.summary && <p className="bpm-t-body" style={{ margin: "0 0 10px" }}>{review.summary}</p>}
          {review.findings.length === 0 ? (
            <div className="bpm-t-help">Nothing flagged.</div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {review.findings.map((f) => (
                <li key={f.title} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}><span style={{ color: "var(--muted)", fontWeight: 500 }}>{KIND[f.kind]}: </span>{f.title}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{f.detail}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="bpm-t-help" style={{ marginTop: 10 }}>Not saved. Written by an AI model from the quantities and totals; check it before relying on it.</div>
        </div>
      )}
    </Card>
  );
}
