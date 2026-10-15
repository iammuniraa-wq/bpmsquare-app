import Link from "next/link";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import Tabs from "@/components/ui/Tabs";
import { CARD_SURFACE } from "@/components/ui/Card";
import { RecordEditProvider } from "./RecordEditContext";

export type RecordTab = {
  id: string;
  label: string;
  count?: number;
  /** Only the active tab's content is rendered. */
  content: React.ReactNode;
};

export type RecordFact = { label: string; value: React.ReactNode };

/**
 * The shared record (detail) page.
 *
 *   <- All <objects>
 *   Title  [status]                          [primary action] [...]
 *   REF . detail
 *   [fact] [fact] [fact] [fact]              (at most four)
 *   Overview | Lines | Related | Activity    (?tab=, first tab is the default)
 *   main column (active tab)                 right rail (stacks on a phone)
 *
 * Server component: the page loads its data, builds the tab contents and
 * passes them in. `menu` is a RecordMoreMenu; `primaryAction` is the
 * object's single next step, or nothing. A single tab hides the strip.
 */
export default function ObjectRecordPage({
  backHref, backLabel, title, tabTitle, reference, meta, status,
  primaryAction, menu, facts = [], tabs, activeTab, basePath, rail,
}: {
  backHref: string;
  /** "All suppliers" -- the arrow is added here. */
  backLabel: string;
  title: string;
  tabTitle?: string;
  reference?: string | null;
  /** The rest of the subtitle after the reference ("Vendor . Mumbai"). */
  meta?: string;
  status?: React.ReactNode;
  primaryAction?: React.ReactNode;
  menu?: React.ReactNode;
  facts?: RecordFact[];
  tabs: RecordTab[];
  /** The `tab` search param as received; unknown values fall back to the first tab. */
  activeTab?: string;
  /** This page's own path, for the tab links. */
  basePath: string;
  rail?: React.ReactNode;
}) {
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const subtitle = [reference, meta].filter(Boolean).join(" · ");
  const shownFacts = facts.slice(0, 4);
  const hrefFor = (id: string) => (id === tabs[0].id ? basePath : `${basePath}?tab=${id}`);

  return (
    <RecordEditProvider>
      <TabTitle title={tabTitle ?? title} />

      <div style={{ marginBottom: 8 }}>
        <Link href={backHref} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>
          ← {backLabel}
        </Link>
      </div>

      <PageHeader
        title={title}
        subtitle={subtitle || undefined}
        badge={status}
        action={(primaryAction || menu) ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {primaryAction}
            {menu}
          </div>
        ) : undefined}
      />

      {shownFacts.length > 0 && (
        <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
          {shownFacts.map((f) => (
            <div key={f.label} style={{ ...CARD_SURFACE, padding: "10px 14px", minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>{f.label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: c.ink, marginTop: 3, wordBreak: "break-word" }}>{f.value}</div>
            </div>
          ))}
        </div>
      )}

      {tabs.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <Tabs tabs={tabs.map(({ id, label, count }) => ({ id, label, count }))} value={active.id} hrefFor={hrefFor} />
        </div>
      )}

      <div
        className="hub-grid"
        style={{ display: "grid", gridTemplateColumns: rail ? "minmax(0, 1fr) 260px" : "minmax(0, 1fr)", gap: 16, alignItems: "start" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>{active.content}</div>
        {rail && <aside aria-label="Context" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>{rail}</aside>}
      </div>
    </RecordEditProvider>
  );
}
