"use client";

import { useState } from "react";
import { useIsNextgen3Layer } from "@/lib/tenant-context";
import FlowBoard from "@/components/FlowBoard";

/**
 * Nova gate for the Flow Board, which plots QUOTES by quote status and so
 * belongs to Quotations -- not to Pipeline, which is reserved for the
 * Opportunity journey board (PROJECT.md §UX principles).
 *
 * A tenant without the flag never sees the toggle: the list is the page,
 * exactly as it is today.
 */
export default function FlowBoardSlot({ list }: { list: React.ReactNode }) {
  const nova = useIsNextgen3Layer();
  const [board, setBoard] = useState(false);

  if (!nova) return <>{list}</>;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <div style={{
          display: "flex", gap: 2, padding: 2, borderRadius: 9,
          border: "1px solid var(--line, #e5e7eb)", background: "var(--panel2, transparent)",
        }}>
          {([["List", false], ["Flow board", true]] as const).map(([label, on]) => (
            <button
              key={label}
              onClick={() => setBoard(on)}
              style={{
                padding: "6px 13px", borderRadius: 7, cursor: "pointer", font: "inherit",
                fontSize: 12.5, fontWeight: 650, border: "none",
                background: board === on ? "var(--panel, #fff)" : "transparent",
                color: board === on ? "var(--ink, #111827)" : "var(--muted, #6b7280)",
                boxShadow: board === on ? "0 1px 3px rgba(0,0,0,.10)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {board ? <FlowBoard /> : list}
    </>
  );
}
