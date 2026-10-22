"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import s from "./middleware.module.css";
import type { AiSuggestion } from "./api";
import Panel from "./Panel";
import { Notice } from "./ui";

export type Labels = { source: (block: "header" | "lines", key: string) => string; target: (block: "header" | "lines", path: string) => string };

const keyOf = (x: AiSuggestion) => `${x.block}:${x.target}`;

/** The AI's suggestions, confirmed one row at a time. Nothing is added until "Add accepted lines", and nothing is saved until Save. */
export default function AiReviewSheet({ suggestions, labels, usagePercent, onApply, onClose }: {
  suggestions: readonly AiSuggestion[]; labels: Labels; usagePercent: number | null; onApply: (accepted: AiSuggestion[]) => void; onClose: () => void;
}) {
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const toggle = (k: string) => setAccepted((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const chosen = suggestions.filter((x) => accepted.has(keyOf(x)));

  return (
    <Panel
      title="Suggestions from AI" subtitle={usagePercent !== null ? `${usagePercent}% of this month's AI allowance used` : undefined} onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={() => setAccepted(new Set(suggestions.map(keyOf)))} disabled={suggestions.length === 0}>Accept all</Button>
          <Button variant="primary" onClick={() => onApply(chosen)} disabled={chosen.length === 0}>{`Add accepted lines (${chosen.length})`}</Button>
        </>
      }
    >
      {suggestions.length === 0 && <Notice tone="info">No suggestions for the empty lines.</Notice>}
      <ul className={s.aiList}>
        {suggestions.map((x) => {
          const k = keyOf(x);
          const on = accepted.has(k);
          return (
            <li key={k} className={s.aiItem} data-accepted={on ? "true" : undefined}>
              <div className={s.aiPair}>
                <span className={s.fieldName}>{labels.source(x.block, x.source)}</span>
                <span aria-hidden="true" className={s.muted}>→</span>
                <span className={s.fieldName}>{labels.target(x.block, x.target)}</span>
              </div>
              {x.reason ? <div className={`${s.small} ${s.muted}`}>{x.reason}</div> : null}
              <div className={s.row}>
                <Button size="sm" variant={on ? "primary" : "secondary"} aria-pressed={on} onClick={() => toggle(k)}>{on ? "Accepted" : "Accept"}</Button>
                {on && <Button size="sm" variant="quiet" onClick={() => toggle(k)}>Skip</Button>}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
