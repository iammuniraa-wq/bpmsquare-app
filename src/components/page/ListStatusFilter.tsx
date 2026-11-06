"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { useRichUi } from "@/lib/tenant-context";
import type { ListChip } from "./ObjectListPage";

// The status filter of every list, collapsed by default: one pill that shows the current filter, and, opened, a donut of the statuses with a
// legend (docs/design/status-donut.md). The filters are still plain links (the list filters through the URL), so nothing here changes what a
// filter does. A list whose chips do not split the records cleanly (a rollup, an overlapping view) opens to the same chips as before.

const PALETTE = [pillar.blue.base, pillar.teal.base, pillar.amber.base, pillar.purple.base, pillar.green.base, pillar.red.base];
const COUNT_AT_END = /^(.*?)\s*\((\d+)\)\s*$/;

type Item = { chip: ListChip; name: string; count: number | null };

const parse = (chip: ListChip): Item => {
  const m = COUNT_AT_END.exec(chip.label);
  return { chip, name: m ? m[1] : chip.label, count: m ? Number(m[2]) : null };
};

const isAll = (i: Item): boolean => i.chip.id === "all" || /^all\b/i.test(i.name);

/** Which chips are the donut's slices (exclusive statuses) and which stay as small pills (All, rollups, cross-cutting views). */
export function splitChips(chips: ListChip[]): { slices: Item[]; also: Item[]; total: number } {
  const items = chips.map(parse);
  const explicit = chips.some((x) => x.kind !== undefined);
  const all = items.find(isAll);
  let slices: Item[] = [];
  if (explicit) {
    slices = items.filter((i) => i.chip.kind === "slice" && i.count !== null);
  } else {
    const others = items.filter((i) => i !== all);
    const sum = others.reduce((s, i) => s + (i.count ?? 0), 0);
    if (all && all.count !== null && others.length >= 2 && others.every((i) => i.count !== null) && sum > 0 && sum === all.count) slices = others;
  }
  const also = items.filter((i) => !slices.includes(i));
  const total = all?.count ?? slices.reduce((s, i) => s + (i.count ?? 0), 0);
  return { slices, also, total };
}

function Donut({ slices, activeId, size, stroke, total, label }: { slices: Item[]; activeId: string | null; size: number; stroke: number; total?: number; label?: string }) {
  const r = 18 - stroke / 2 - 1;
  const sum = slices.reduce((s, i) => s + (i.count ?? 0), 0);
  const dimOthers = activeId !== null && slices.some((i) => i.chip.id === activeId);
  const drawn = slices.filter((x) => (x.count ?? 0) > 0).length;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" role="img" aria-label={label ?? "Status split"} style={{ flex: "none" }}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--panel2)" strokeWidth={stroke} />
      {sum > 0 && slices.map((s, i) => {
        const len = ((s.count ?? 0) / sum) * 100;
        if (len <= 0) return null;
        const arc = Math.max(0, len - (drawn > 1 ? 1.2 : 0));
        const el = (
          <circle
            key={s.chip.id} cx="18" cy="18" r={r} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={stroke}
            pathLength={100} strokeDasharray={`${arc} ${100 - arc}`} strokeDashoffset={25 - offset}
            opacity={dimOthers && s.chip.id !== activeId ? 0.25 : 1}
          />
        );
        offset += len;
        return el;
      })}
      {total !== undefined && (
        <>
          <text x="18" y="18.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="var(--ink)">{total}</text>
          <text x="18" y="24" textAnchor="middle" fontSize="3.2" fill="var(--hint)">total</text>
        </>
      )}
    </svg>
  );
}

/** The chip row every list drew before the donut, kept for any workspace the donut has not been switched on for. */
function PlainChips({ chips }: { chips: ListChip[] }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
      {chips.map((chip) => (
        <Link key={chip.id} href={chip.href} aria-current={chip.active ? "true" : undefined} style={{
          fontSize: 12.5, fontWeight: chip.active ? 700 : 500,
          color: chip.active ? c.accent : c.muted,
          background: chip.active ? c.accentbg : c.panel2,
          border: `1px solid ${chip.active ? c.accent + "60" : c.line}`,
          borderRadius: 6, padding: "5px 12px", textDecoration: "none",
        }}>
          {chip.label}
        </Link>
      ))}
    </div>
  );
}

// `enabled` is the switch: today the donut is on for the Rich look only (owner review on the demo first); every other workspace keeps PlainChips.
export default function ListStatusFilter({ chips, enabled }: { chips: ListChip[]; enabled?: boolean }) {
  const rich = useRichUi();
  const on = enabled ?? rich;
  return on ? <DonutFilter chips={chips} /> : <PlainChips chips={chips} />;
}

function DonutFilter({ chips }: { chips: ListChip[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { slices, also, total } = splitChips(chips);
  const active = chips.find((x) => x.active) ?? chips[0];
  const activeSlice = slices.find((i) => i.chip.active)?.chip.id ?? null;
  const hasDonut = slices.length >= 2;

  const pill = (it: Item) => (
    <Link
      key={it.chip.id} href={it.chip.href} aria-current={it.chip.active ? "true" : undefined}
      style={{
        fontSize: 13, fontWeight: it.chip.active ? 700 : 500, color: it.chip.active ? c.accent : c.muted,
        background: it.chip.active ? c.accentbg : c.panel2, border: `1px solid ${it.chip.active ? c.accent + "60" : c.line}`,
        borderRadius: 999, padding: "5px 14px", textDecoration: "none",
      }}
    >
      {it.chip.label}
    </Link>
  );

  return (
    <div className="bpm-sf" style={{ marginBottom: 14 }} data-guide="list.status-filter">
      <button
        type="button" className="bpm-sf__head" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 10, maxWidth: "100%", minHeight: 44, padding: "6px 14px 6px 10px", borderRadius: 999,
          border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer", font: "inherit", fontSize: 14, fontWeight: 600, textAlign: "left",
        }}
      >
        {hasDonut ? <Donut slices={slices} activeId={activeSlice} size={28} stroke={7} /> : null}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active.label}</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ flex: "none", color: c.hint, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}
        ><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div id={panelId} className="bpm-sf__panel" style={{ marginTop: 10, padding: 14, borderRadius: 16, border: `1px solid ${c.line}`, background: c.panel }}>
          {hasDonut ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <Donut slices={slices} activeId={activeSlice} size={132} stroke={5} total={total} label="Records by status" />
              <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                {slices.map((s, i) => (
                  <Link
                    key={s.chip.id} href={s.chip.href} aria-current={s.chip.active ? "true" : undefined}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "4px 10px", borderRadius: 10, textDecoration: "none", color: c.ink, fontSize: 14,
                      background: s.chip.active ? c.accentbg : "transparent", fontWeight: s.chip.active ? 700 : 500,
                    }}
                  >
                    <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: PALETTE[i % PALETTE.length], flex: "none" }} />
                    <span style={{ flex: 1, minWidth: 0 }}>{s.name}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: c.muted }}>{s.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          {also.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: hasDonut ? 12 : 0 }}>{also.map(pill)}</div>
          )}
        </div>
      )}
    </div>
  );
}
