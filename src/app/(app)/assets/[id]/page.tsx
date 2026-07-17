import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssetLive } from "@/lib/data/live";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import CustomFieldsSection from "@/components/CustomFieldsSection";
import AssetHeaderCard from "./AssetHeaderCard";

const CASE_TONE: Record<string, PillarKey> = {
  intake: "blue", inspection: "teal",
  report_sent: "amber", report_approved: "green",
  quote_sent: "amber", quote_approved: "green",
  in_repair: "amber", qa: "teal",
  ready: "green", closed: "green",
  buyback: "purple", scrapped: "red",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getAssetLive(id);
  if (!data) notFound();
  const { asset, account, cases } = data;

  const openCases  = cases.filter((c) => !["closed", "buyback", "scrapped"].includes(c.status));
  const closedCases = cases.filter((c) => ["closed", "buyback", "scrapped"].includes(c.status));

  return (
    <>
      <TabTitle title={asset.name} />

      <AssetHeaderCard asset={asset} account={account} casesCount={cases.length} openCasesCount={openCases.length} />

      <div style={{ marginBottom: 14 }}>
        <CustomFieldsSection
          objectType="asset"
          recordId={asset.id}
          customData={asset.custom_data}
          patchUrl={`/api/assets/${asset.id}`}
        />
      </div>

      {/* Open cases */}
      {openCases.length > 0 && (
        <section style={{ ...cardStyle, marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: c.ink }}>
            Open cases
            <span style={{ marginLeft: 8, fontSize: 11, background: pillar.amber.bg, color: pillar.amber.fg, borderRadius: 4, padding: "1px 7px" }}>
              {openCases.length}
            </span>
          </h3>
          {openCases.map((sc) => (
            <CaseRow key={sc.id} sc={sc} />
          ))}
        </section>
      )}

      {/* Service history */}
      {closedCases.length > 0 && (
        <section style={cardStyle}>
          <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: c.ink }}>
            Service history
            <span style={{ marginLeft: 8, fontSize: 11, background: c.panel2, color: c.muted, borderRadius: 4, padding: "1px 7px" }}>
              {closedCases.length}
            </span>
          </h3>
          {closedCases.map((sc) => (
            <CaseRow key={sc.id} sc={sc} />
          ))}
        </section>
      )}

      {cases.length === 0 && (
        <div style={{ ...cardStyle, textAlign: "center", padding: "32px 16px", color: c.hint, fontSize: 13 }}>
          No service history yet.
          {account && (
            <div style={{ marginTop: 10 }}>
              <Link href={`${ROUTES.caseNew}?account_id=${account.id}`}
                style={{ fontSize: 13, fontWeight: 600, color: c.accent, textDecoration: "none" }}>
                + Create first case →
              </Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function CaseRow({ sc }: { sc: { id: string; ref: string; status: string; type: string; complaint: string; equipment_label: string; intake_at: string; closed_at?: string | null } }) {
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div style={{ padding: "9px 0", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{sc.ref}</span>
          <Pill label={CASE_STATUS_LABEL[sc.status as keyof typeof CASE_STATUS_LABEL] ?? sc.status} tone={CASE_TONE[sc.status] ?? "blue"} />
          <Pill label={CASE_TYPE_LABEL[sc.type as keyof typeof CASE_TYPE_LABEL] ?? sc.type} tone="blue" />
        </div>
        <div style={{ fontSize: 11, color: c.hint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sc.complaint}
        </div>
        <div style={{ fontSize: 10.5, color: c.hint, marginTop: 1 }}>
          {fmtDate(sc.intake_at)}
          {sc.closed_at && <span> → {fmtDate(sc.closed_at)}</span>}
        </div>
      </div>
      <Link href={ROUTES.case(sc.id)} style={{ fontSize: 11, fontWeight: 600, color: c.accent, background: c.accentbg, borderRadius: 6, padding: "3px 8px", textDecoration: "none", flexShrink: 0 }}>
        Open →
      </Link>
    </div>
  );
}
