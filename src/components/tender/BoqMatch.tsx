"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { MatchState, ProductHit } from "@/lib/tender/boq/matchServer";

// "Match to products" on the BOQ Prices tab (GCC tender deals). A BOQ line is free text; linking it to a catalog product lets the
// BOM and supplier price sources find it. The chip says how many lines have no product; opening it lists each with up to three
// ranked suggestions. A person accepts one, searches for another product, or leaves the line as free text. "Accept strong matches"
// links only unambiguous strong ones (the server decides, not this screen). Only name, SKU and unit are shown -- never a cost.

const PAGE = 10;
const HIT_MIN = 2;

export default function BoqMatch({ base, count, canEdit, onChanged, onError, onNotice, initialData, initialOpen }: {
  /** /api/opportunities/[id]/boq */
  base: string;
  /** Lines without a product, from the BOQ state (the chip). */
  count: number;
  canEdit: boolean;
  /** Called after lines were linked, so the BOQ state and the deal page reload. */
  onChanged: () => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  /** Lets a server render (and its test) show the open panel without a fetch. The page never passes them. */
  initialData?: MatchState;
  initialOpen?: boolean;
}) {
  const { confirm } = useFeel();
  const [open, setOpen] = useState(initialOpen ?? false);
  const [data, setData] = useState<MatchState | null>(initialData ?? null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`${base}/match`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { onError(j.error ?? "Could not load the matches"); return; }
    setData(j as MatchState);
  }, [base, onError]);
  useEffect(() => { if (open && !initialData) void load(); }, [open, load, initialData]);

  useEffect(() => {
    if (!pick || q.trim().length < HIT_MIN) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const res = await fetch(`${base}/match?q=${encodeURIComponent(q.trim())}`);
      const j = await res.json().catch(() => ({}));
      if (live && res.ok) setHits((j.products ?? []) as ProductHit[]);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, pick, base]);

  async function send(body: Record<string, unknown>): Promise<{ linked: number; skipped: number } | null> {
    setBusy(true); onError("");
    const res = await fetch(`${base}/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_version: data?.lines_version, ...body }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(j.error ?? "Could not link the product");
      if (j.code === "lines_changed") { await load(); onChanged(); }
      return null;
    }
    await load();
    onChanged();
    return j as { linked: number; skipped: number };
  }

  async function link(boqId: string, productId: string) {
    const out = await send({ links: [{ line: boqId, product_id: productId }] });
    if (out) { setPick(null); setQ(""); onNotice(out.linked ? "Product linked" : "That line already has a product"); }
  }

  async function acceptStrong() {
    if (!data) return;
    if (!(await confirm({ title: `Link ${data.strong} line${data.strong === 1 ? "" : "s"} to the strongest match?`, body: "Only strong matches with no tie are linked. The client's wording and unit stay as they are.", confirmLabel: "Link them" }))) return;
    const out = await send({ accept_strong: true });
    if (out) onNotice(`${out.linked} line${out.linked === 1 ? "" : "s"} linked to a product`);
  }

  if (count <= 0 && !open) return null;

  const rows = (data?.rows ?? []).filter((r) => !left.has(r.boq_id));
  const shown = showAll ? rows : rows.slice(0, PAGE);

  return (
    <div data-guide="boq.match" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button type="button" data-guide="boq.match.chip" aria-expanded={open} onClick={() => setOpen(!open)}
          style={{ minHeight: 44, padding: "0 12px", borderRadius: 999, border: `1px solid ${c.line}`, background: "var(--amberbg)", color: "var(--amberink)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          {count} line{count === 1 ? "" : "s"} without a product
        </button>
        <InfoTip label="Match to products">{TENDER_TIPS.boqMatch}</InfoTip>
      </div>

      {open && (
        <div data-guide="boq.match.panel" style={{ marginTop: 8, background: "var(--panel2)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: 13, color: c.ink }}>Match to products</b>
            <InfoTip label="Strong and possible">{TENDER_TIPS.boqMatchBands}</InfoTip>
            {canEdit && data && data.strong > 0 && (
              <Button variant="primary" size="sm" loading={busy} onClick={() => void acceptStrong()} style={{ minHeight: 44, marginLeft: "auto" }} data-guide="boq.match.accept_strong">
                Accept {data.strong} strong match{data.strong === 1 ? "" : "es"}
              </Button>
            )}
          </div>

          {!data && <div style={{ fontSize: 12.5, color: c.hint }}>Looking…</div>}
          {data && !data.enabled && <div style={{ fontSize: 12.5, color: c.hint }}>This workspace has no product catalog to match against.</div>}
          {data?.enabled && rows.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>Every line has a product, or was left as free text.</div>}

          {shown.map((r) => (
            <div key={r.boq_id} data-guide="boq.match.line" style={{ borderTop: `1px solid ${c.line}`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, fontSize: 12.5, color: c.ink, minWidth: 36 }}>{r.item_no ?? "·"}</span>
                <span style={{ flex: "1 1 200px", fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{r.description}</span>
                <span style={{ fontSize: 12, color: c.muted, whiteSpace: "nowrap" }}>{r.qty} {r.uom ?? ""}{r.cost_code ? ` · ${r.cost_code}` : ""}</span>
              </div>
              {r.suggestions.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>No close product found.</div>}
              {r.suggestions.map((s) => (
                <button key={s.product_id} type="button" data-guide="boq.match.suggestion" title={s.reason} disabled={!canEdit || busy} onClick={() => void link(r.boq_id, s.product_id)}
                  style={{ textAlign: "left", background: "transparent", border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", minHeight: 44, cursor: canEdit ? "pointer" : "default", color: c.ink, display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
                  <span style={{ fontSize: 12.5, flex: "1 1 180px", overflowWrap: "anywhere", fontWeight: 600 }}>{s.name}</span>
                  <span style={{ fontSize: 12, color: c.muted }}>{[s.sku, s.uom].filter(Boolean).join(" · ")}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: s.band === "strong" ? "var(--tealink)" : "var(--amberink)" }}>{s.band === "strong" ? "Strong" : "Possible"}</span>
                </button>
              ))}
              {canEdit && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="boq.match.search_open" onClick={() => { setPick(pick === r.boq_id ? null : r.boq_id); setQ(""); setHits([]); }}>{pick === r.boq_id ? "Close search" : "Pick another product"}</Button>
                  <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="boq.match.skip" onClick={() => setLeft(new Set([...left, r.boq_id]))}>Leave as free text</Button>
                </div>
              )}
              {pick === r.boq_id && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products by name or SKU" aria-label="Search products" data-guide="boq.match.search" autoFocus />
                  {hits.map((h) => (
                    <button key={h.id} type="button" data-guide="boq.match.hit" disabled={busy} onClick={() => void link(r.boq_id, h.id)}
                      style={{ textAlign: "left", background: "transparent", border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", minHeight: 44, cursor: "pointer", color: c.ink, display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
                      <span style={{ fontSize: 12.5, flex: "1 1 180px", overflowWrap: "anywhere", fontWeight: 600 }}>{h.name}</span>
                      <span style={{ fontSize: 12, color: c.muted }}>{[h.sku, h.uom].filter(Boolean).join(" · ")}</span>
                    </button>
                  ))}
                  {q.trim().length >= HIT_MIN && hits.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>No product found.</div>}
                </div>
              )}
            </div>
          ))}
          {rows.length > PAGE && (
            <Button variant="quiet" onClick={() => setShowAll(!showAll)} style={{ minHeight: 44 }} data-guide="boq.match.show_all">{showAll ? "Show fewer" : `Show all ${rows.length} lines`}</Button>
          )}
        </div>
      )}
    </div>
  );
}
