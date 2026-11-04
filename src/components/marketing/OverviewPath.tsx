import Link from "next/link";
import { c } from "@/lib/theme";

export type PathStep = {
  n: number;
  label: string;
  /** The headline number or word. */
  value: string | null;
  /** One short line; the next step when there is nothing yet. */
  text: string;
  href: string;
  action: string;
  tone?: "good" | "warn";
};

/**
 * The four-step path both Overview screens show (docs/design/marketing-two-parts.md section 6): a number, one line, one
 * button per step. Server component; a step for a module the workspace did not buy is simply not passed in.
 */
export default function OverviewPath({ steps }: { steps: PathStep[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
      {steps.map((s) => (
        <div key={s.n} style={{ border: `1px solid ${c.line}`, borderRadius: 12, background: s.tone === "warn" ? "var(--amberbg)" : s.tone === "good" ? "var(--tealbg)" : c.panel, padding: 12, display: "flex", flexDirection: "column", gap: 4, minHeight: 140 }}>
          <span aria-hidden style={{ width: 24, height: 24, borderRadius: "50%", background: c.accent, color: "#fff", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{s.n}</span>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: c.muted }}>{s.label}</div>
          {s.value && <div style={{ fontSize: 22, fontWeight: 700, color: c.ink }}>{s.value}</div>}
          <div style={{ fontSize: 12.5, color: c.hint, flex: 1 }}>{s.text}</div>
          <Link href={s.href} style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: c.accent, fontWeight: 600, fontSize: 13 }}>{s.action}</Link>
        </div>
      ))}
    </div>
  );
}
