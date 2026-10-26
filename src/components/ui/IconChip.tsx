import { toneTokens, type Tone } from "@/lib/ui/tone";

/** A small tinted square holding one SVG, for the start of a page or section title. Decorative: the title carries the meaning. */
export default function IconChip({ tone = "info", children, size = 32 }: { tone?: Tone; children: React.ReactNode; size?: number }) {
  const t = toneTokens(tone);
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: 9, background: t.bg, color: t.ink, border: `1px solid ${t.edge}`, flexShrink: 0 }}>
      {children}
    </span>
  );
}
