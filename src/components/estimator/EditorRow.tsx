"use client";

import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";

/**
 * One row of a template editor list: a bordered block with its number and
 * name, move up / move down / remove, the row's fields, and the problems the
 * server found on it. Fields stack on a phone (the `fg2` grid).
 */
export default function EditorRow({
  index, title, count, onMove, onRemove, problems = [], children,
}: {
  index: number;
  title: string;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  problems?: string[];
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: `1px solid ${problems.length ? "var(--err-line)" : c.line}`, borderRadius: 10, padding: 12, background: "var(--card-bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: c.hint }}>{index + 1}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{title || "Untitled"}</span>
        <Button size="sm" variant="quiet" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${title || "row"} up`}>Up</Button>
        <Button size="sm" variant="quiet" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${title || "row"} down`}>Down</Button>
        <Button size="sm" variant="quiet" onClick={onRemove} aria-label={`Remove ${title || "row"}`}>Remove</Button>
      </div>
      {children}
      {problems.length > 0 && (
        <ul role="alert" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--err-ink)" }}>
          {problems.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}
