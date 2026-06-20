import { listPricingItems, PRICING_CATEGORY_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ComingSoon from "@/components/ComingSoon";
import type { PricingCategory } from "@/lib/types";

const CAT_TONE: Record<PricingCategory, PillarKey> = {
  labour: "blue", material: "teal", testing: "purple", transport: "amber",
};

export default async function PricingConfigPage() {
  const items = await listPricingItems();
  const categories: PricingCategory[] = ["labour", "material", "testing", "transport"];

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <PageHeader title="Pricing catalog" subtitle={`Configure · ${items.length} items across ${categories.length} categories`} />
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.accentbg, color: c.accent, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, marginTop: 4, cursor: "not-allowed" }}>
          + Add item <ComingSoon size="xs" />
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {categories.map((cat) => {
          const catItems = items.filter((i) => i.category === cat);
          return (
            <section key={cat} style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <Pill label={PRICING_CATEGORY_LABEL[cat]} tone={CAT_TONE[cat]} />
                <span style={{ fontSize: 12, color: c.hint }}>{catItems.length} items</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 90px 80px", gap: 12, padding: "0 0 6px", borderBottom: `1px solid ${c.line}` }}>
                {["Description", "Unit", "Rate (₹)", ""].map((h) => (
                  <div key={h} style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
                ))}
              </div>

              {catItems.map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 90px 80px", gap: 12, padding: "10px 0", borderBottom: `1px solid ${c.line}`, alignItems: "start" }}>
                  <div>
                    <div style={{ fontSize: 13, color: c.ink, lineHeight: 1.4 }}>{item.description}</div>
                    {item.notes && (
                      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 3 }}>{item.notes}</div>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: c.muted }}>{item.unit}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>
                    ₹{item.rate.toLocaleString("en-IN")}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span style={{ fontSize: 11, color: c.accent, background: c.accentbg, borderRadius: 5, padding: "2px 8px", cursor: "not-allowed" }}>
                      Edit <ComingSoon size="xs" />
                    </span>
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
