import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

export type QuickCreateItem = { href: string; label: string; icon: React.ReactNode; bg: string };

// Same visual pattern as the Dashboard's "Quick create" sidebar block —
// a short list of buttons to jump straight into creating a related object.
export default function QuickCreateDeck({ items }: { items: QuickCreateItem[] }) {
  return (
    <section style={{ ...cardStyle, padding: "14px 14px 12px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
        Quick create
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item) => (
          <Link key={item.href + item.label} href={item.href} style={{
            display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", borderRadius: 8,
            background: item.bg, border: `1px solid ${c.line}`, textDecoration: "none",
            fontSize: 12.5, color: c.ink, fontWeight: 600,
          }}>
            {item.icon}{item.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
