import { bondState, type BondStatus, type BondTone } from "@/lib/tender/bond";

// The bid bond's state as a chip: amber 30 days before it expires, red once it has, quiet once it has been released.
// The text says it ("Expires in 12 days"), so it reads without the colour. Same look as the closing-date chip.

const TONE: Record<BondTone, { bg: string; fg: string; line: string }> = {
  none: { bg: "var(--panel2)", fg: "var(--muted)", line: "var(--line)" },
  ok: { bg: "var(--tealbg)", fg: "var(--tealink)", line: "transparent" },
  amber: { bg: "var(--amberbg)", fg: "var(--amberink)", line: "var(--amberline)" },
  red: { bg: "var(--redbg)", fg: "var(--redink)", line: "var(--red)" },
};

export default function BondChip({ amount, expiry, status, nowIso, timezone }: {
  amount: number | null;
  expiry: string | null;
  status: BondStatus;
  nowIso: string;
  timezone: string;
}) {
  const state = bondState({ bid_bond_amount: amount, bid_bond_expiry: expiry, bond_status: status }, new Date(nowIso), timezone);
  if (state.tone === "none") return null;
  const t = TONE[state.tone];
  return (
    <span data-tone={state.tone} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", fontWeight: 600, fontSize: 12, padding: "3px 10px", borderRadius: 999, background: t.bg, color: t.fg, border: `1px solid ${t.line}` }}>
      Bond: {state.label}
    </span>
  );
}
