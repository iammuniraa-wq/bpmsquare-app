import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssetLive } from "@/lib/data/live";
import { getUserRole, getTenant } from "@/lib/tenant";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/data";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { ROUTES } from "@/lib/constants";
import ObjectSections from "@/components/fields/ObjectSections";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import RelatedList, { type RelatedColumn } from "@/components/page/RelatedList";

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

type CaseRowData = { id: string; ref: string; status: string; type: string; complaint: string; equipment_label: string; intake_at: string; closed_at?: string | null };

const CASE_COLUMNS: RelatedColumn<CaseRowData>[] = [
  { label: "Ref", render: (sc) => <span style={{ fontWeight: 600, color: c.ink }}>{sc.ref}</span> },
  { label: "Stage", render: (sc) => <StatusPill label={CASE_STATUS_LABEL[sc.status as keyof typeof CASE_STATUS_LABEL] ?? sc.status} tone={CASE_TONE[sc.status] ?? "blue"} /> },
  { label: "Type", render: (sc) => <StatusPill label={CASE_TYPE_LABEL[sc.type as keyof typeof CASE_TYPE_LABEL] ?? sc.type} tone="blue" /> },
  { label: "Complaint", cellStyle: { maxWidth: 240, color: c.muted, fontSize: 12.5 }, render: (sc) => (
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{sc.complaint || "—"}</span>
  ) },
  { label: "Intake", cellStyle: { color: c.hint, fontSize: 12, whiteSpace: "nowrap" }, render: (sc) => fmtDate(sc.intake_at) },
  { label: "Closed", cellStyle: { color: c.hint, fontSize: 12, whiteSpace: "nowrap" }, render: (sc) => (sc.closed_at ? fmtDate(sc.closed_at) : "—") },
];

export default async function AssetDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const [data, role, tenant] = await Promise.all([getAssetLive(id), getUserRole(), getTenant()]);
  if (!data) notFound();
  const { asset, account, cases } = data;
  const isAdmin = role === "admin";
  const casesOn = tenant?.features?.cases === true;
  const basePath = ROUTES.asset(asset.id);

  const openCases  = cases.filter((sc) => !["closed", "buyback", "scrapped"].includes(sc.status));
  const closedCases = cases.filter((sc) => ["closed", "buyback", "scrapped"].includes(sc.status));
  const newCaseHref = account ? `${ROUTES.caseNew}?account_id=${account.id}` : undefined;

  return (
    <ObjectRecordPage
      backHref={ROUTES.assets}
      backLabel="All assets"
      title={asset.name}
      reference={asset.ref}
      meta={[asset.kind.charAt(0).toUpperCase() + asset.kind.slice(1), asset.make, asset.model].filter(Boolean).join(" · ")}
      primaryAction={casesOn && newCaseHref ? <Button href={newCaseHref} variant="primary">+ New Case</Button> : undefined}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: basePath }}
          adapt={{ objectType: "asset", objectLabel: "Asset", isAdmin }}
        />
      }
      facts={[
        ...(asset.serial ? [{ label: "Serial no.", value: <span style={{ fontFamily: "monospace" }}>{asset.serial}</span> }] : []),
        ...(asset.rating ? [{ label: "Rating / specs", value: asset.rating }] : []),
        ...(account ? [{ label: "Account", value: <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none" }}>{account.name}</Link> }] : []),
        ...(casesOn ? [{ label: "Service history", value: <>{cases.length} case{cases.length === 1 ? "" : "s"}{openCases.length > 0 && <span style={{ color: c.accent }}> · {openCases.length} open</span>}</> }] : []),
      ]}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <ObjectSections
              objectType="asset"
              record={asset as unknown as Record<string, unknown>}
              patchUrl={`/api/assets/${asset.id}`}
              exclude={["name", "kind", "make", "model", "serial", "rating", "notes"]}
            />
          ),
        },
        ...(casesOn ? [{
          id: "cases",
          label: "Service history",
          count: cases.length,
          content: cases.length === 0 ? (
            <RelatedList
              title="Service history"
              newHref={newCaseHref}
              newLabel="Case"
              emptyText="No service history yet."
              rows={[] as CaseRowData[]}
              rowKey={(sc) => sc.id}
              columns={CASE_COLUMNS}
            />
          ) : (
            <>
              {openCases.length > 0 && (
                <RelatedList
                  title={`Open cases (${openCases.length})`}
                  newHref={newCaseHref}
                  newLabel="Case"
                  emptyText=""
                  rows={openCases as CaseRowData[]}
                  rowKey={(sc) => sc.id}
                  rowHref={(sc) => ROUTES.case(sc.id)}
                  columns={CASE_COLUMNS}
                />
              )}
              {closedCases.length > 0 && (
                <RelatedList
                  title={`Service history (${closedCases.length})`}
                  emptyText=""
                  rows={closedCases as CaseRowData[]}
                  rowKey={(sc) => sc.id}
                  rowHref={(sc) => ROUTES.case(sc.id)}
                  columns={CASE_COLUMNS}
                />
              )}
            </>
          ),
        }] : []),
        {
          id: "activity",
          label: "Activity",
          content: <RecordActivity objectType="assets" objectId={asset.id} isAdmin={isAdmin} />,
        },
      ]}
      rail={asset.notes ? (
        <Card title="Notes" padding={14}>
          <div style={{ fontSize: 12.5, color: c.muted, fontStyle: "italic", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{asset.notes}</div>
        </Card>
      ) : undefined}
    />
  );
}
