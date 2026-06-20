import { listTextFragments } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ComingSoon from "@/components/ComingSoon";
import type { FragmentCategory } from "@/lib/types";

const CAT_LABEL: Record<FragmentCategory, string> = {
  line_item: "Line item descriptions",
  notes:     "Note templates",
  terms:     "Terms & conditions",
};
const CAT_TONE: Record<FragmentCategory, PillarKey> = {
  line_item: "blue", notes: "teal", terms: "amber",
};
const CAT_DESC: Record<FragmentCategory, string> = {
  line_item: "Pre-written scope descriptions you can insert directly into quotation line items",
  notes:     "Reusable notes for copper clauses, warranty, transport, and special conditions",
  terms:     "Standard terms and conditions presets — payment terms, AMC, emergency callout",
};

export default async function QuoteConfigPage() {
  const fragments = await listTextFragments();
  const categories: FragmentCategory[] = ["line_item", "notes", "terms"];

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <PageHeader title="Quote config" subtitle={`Configure · Text fragments & terms presets · ${fragments.length} templates`} />
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.accentbg, color: c.accent, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, marginTop: 4, cursor: "not-allowed" }}>
          + New template <ComingSoon size="xs" />
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {categories.map((cat) => {
          const catFrags = fragments.filter((f) => f.category === cat);
          return (
            <section key={cat} style={cardStyle}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Pill label={CAT_LABEL[cat]} tone={CAT_TONE[cat]} />
                  <span style={{ fontSize: 12, color: c.hint }}>{catFrags.length} templates</span>
                </div>
                <p style={{ fontSize: 12, color: c.muted, margin: 0 }}>{CAT_DESC[cat]}</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {catFrags.map((frag) => (
                  <div key={frag.id} style={{ padding: "14px 0", borderTop: `1px solid ${c.line}`, display: "grid", gridTemplateColumns: "180px 1fr 80px", gap: 16, alignItems: "start" }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{frag.label}</div>
                    <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{frag.text}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, color: c.accent, background: c.accentbg, borderRadius: 5, padding: "3px 8px", cursor: "not-allowed", textAlign: "center" }}>
                        Edit <ComingSoon size="xs" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
