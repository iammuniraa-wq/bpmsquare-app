"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

type Segment = { id: string; code: string; name: string };

/** Coverage's product availability gating -- restricts which segments this
 * product is sellable to. Empty = sellable everywhere (unchanged default),
 * so this card only renders once a tenant has the Coverage module on. */
export default function ProductAvailabilityCard({ productId, initial }: { productId: string; initial: string[] }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings/coverage/segments")
      .then((r) => r.json())
      .then((rows) => setSegments(Array.isArray(rows) ? rows : []))
      .finally(() => setLoaded(true));
  }, []);

  async function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
    setSaving(true);
    try {
      await fetch(`/api/products/${productId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ available_segment_ids: [...next] }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <section style={{ ...cardStyle, padding: "14px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        Availability
      </div>
      {segments.length === 0 ? (
        <div style={{ fontSize: 12, color: c.hint }}>No segments defined yet — sellable everywhere.</div>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 8 }}>
            {selected.size === 0 ? "Sellable everywhere (no restriction)." : "Restricted to accounts matching:"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {segments.map((s) => (
              <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.ink, cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(s.id)} disabled={saving} onChange={() => toggle(s.id)} />
                {s.code} — {s.name}
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
