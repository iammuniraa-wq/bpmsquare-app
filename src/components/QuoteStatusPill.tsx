import type { QuoteStatusDef } from "@/lib/constants";

// Renders a quote's status using the tenant's actual configured colour/label
// (Settings -> Statuses) instead of a fixed 4-status map -- a tenant that
// renamed or added quote statuses would otherwise see a blank pill for any
// quote sitting in a status this component doesn't recognize.
export default function QuoteStatusPill({ status, statuses }: { status: string; statuses: QuoteStatusDef[] }) {
  const def = statuses.find((s) => s.value === status);
  const color = def?.color ?? "#94a3b8";
  const label = def?.label ?? status;
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 12,
      fontSize: 11.5, fontWeight: 600,
      background: `${color}22`, color, border: `1px solid ${color}55`,
    }}>
      {label}
    </span>
  );
}
