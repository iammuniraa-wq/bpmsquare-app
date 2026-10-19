"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import { useCurrency } from "@/lib/tenant-context";
import { formatMoney } from "@/lib/currency";
import { useFeel } from "@/components/FeelProvider";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import type { MissingComponent } from "@/lib/products/bom";

export type BomSummaryData = {
  total: number;
  incomplete: boolean;
  missing: MissingComponent[];
  hasLoop: boolean;
  asOf: string | null;
  undated: number;
  lineCount: number;
};

const STALE_DAYS = 30;
const box = (tone: "amber" | "red"): React.CSSProperties => ({
  background: tone === "amber" ? "var(--amberbg)" : "var(--err-bg)",
  border: `1px solid ${tone === "amber" ? "var(--amberbg)" : "var(--err-line)"}`,
  color: tone === "amber" ? "var(--amberink)" : "var(--err-ink)",
  borderRadius: 8, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.5, marginTop: 12,
});

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="bpm-t-label" style={{ marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: c.hint, marginTop: 2 }}>{note}</div>}
    </div>
  );
}

export default function BomCostSummary({ productId, data, storedCost, storedAsOf, canEdit }: {
  productId: string;
  data: BomSummaryData;
  storedCost: number | null;
  storedAsOf: string | null;
  canEdit: boolean;
}) {
  const cur = useCurrency();
  const router = useRouter();
  const { confirm, toast } = useFeel();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const money = (n: number | null) => (n == null ? "—" : formatMoney(n, cur, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const diff = storedCost != null ? Math.round((data.total - storedCost) * 100) / 100 : null;
  const ageDays = data.asOf ? Math.round((Date.now() - Date.parse(data.asOf)) / 86_400_000) : null;
  const stale = ageDays !== null && ageDays > STALE_DAYS;

  async function apply(allowIncomplete: boolean) {
    const ok = await confirm({
      title: allowIncomplete ? "Apply an incomplete cost?" : "Apply to product cost?",
      body: `Cost price changes from ${money(storedCost)} to ${money(data.total)}, and "cost price as of" becomes today.${allowIncomplete ? ` ${data.missing.length} component${data.missing.length === 1 ? " has" : "s have"} no cost, so this understates the real cost.` : ""} Pricing and quotes use it from now on.`,
      confirmLabel: "Apply",
      tone: allowIncomplete ? "danger" : "default",
    });
    if (!ok) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/products/${productId}/bom/apply-cost`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowIncomplete }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not apply the cost"); return; }
      toast({ text: "Product cost updated", tone: "success" });
      router.refresh();
    } catch { setError("Network error"); } finally { setBusy(false); }
  }

  return (
    <Card title="Cost roll-up" padding={16}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
        <Figure label="Rolled-up cost" value={money(data.total)} note={`${data.lineCount} component${data.lineCount === 1 ? "" : "s"}`} />
        <Figure label="Stored cost price" value={money(storedCost)} note={storedAsOf ? `as of ${storedAsOf}` : undefined} />
        <Figure label="Difference" value={diff == null ? "—" : `${diff > 0 ? "+" : ""}${money(diff)}`} note={diff === 0 ? "Same as the stored cost" : undefined} />
      </div>

      {data.hasLoop && <div role="alert" style={box("red")}>These components loop back on themselves or are nested more than 8 levels deep, so the cost can&apos;t be fully worked out.</div>}
      {data.missing.length > 0 && (
        <div role="alert" style={box("amber")}>
          <strong>Incomplete: {data.missing.length} component{data.missing.length === 1 ? " has" : "s have"} no cost.</strong>{" "}
          The total leaves {data.missing.length === 1 ? "it" : "them"} out, it does not count {data.missing.length === 1 ? "it" : "them"} as zero. Set a cost price on:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {data.missing.map((m) => (
              <li key={m.id}><Link href={ROUTES.product(m.id)} style={{ color: "inherit", fontWeight: 600 }}>{m.name}</Link>{m.sku ? ` (${m.sku})` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      {(stale || data.undated > 0) && (
        <div style={{ fontSize: 12, color: stale ? "var(--amberink)" : c.hint, marginTop: 12 }}>
          {stale && `The oldest component cost is from ${data.asOf} (${ageDays} days ago), so the engine may treat this as stale. `}
          {data.undated > 0 && `${data.undated} component cost${data.undated === 1 ? " has" : "s have"} no date.`}
        </div>
      )}

      {canEdit && data.lineCount > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
          <Button variant="primary" loading={busy} disabled={data.incomplete || data.total === storedCost} onClick={() => apply(false)}>Apply to product cost</Button>
          {data.incomplete && !data.hasLoop && <Button variant="danger" disabled={busy} onClick={() => apply(true)}>Apply anyway</Button>}
          {!data.incomplete && data.total === storedCost && <span style={{ fontSize: 12, color: c.hint }}>The stored cost already matches.</span>}
        </div>
      )}
      {error && <div role="alert" style={box("red")}>{error}</div>}
    </Card>
  );
}
