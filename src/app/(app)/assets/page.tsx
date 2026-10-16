import Link from "next/link";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { ROUTES } from "@/lib/constants";
import { listAssetsLive, type AssetRow } from "@/lib/data/live";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import KindIcon from "./KindIcon";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SORT_EXTRACTORS: Record<string, SortExtractor<AssetRow>> = {
  ref: (r) => r.asset.ref,
  name: (r) => r.asset.name,
  kind: (r) => r.asset.kind,
  make: (r) => [r.asset.make, r.asset.model].filter(Boolean).join(" "),
  serial: (r) => r.asset.serial,
  account: (r) => r.account?.name,
  cases: (r) => r.openCaseCount,
};

const KIND_LABEL: Record<string, string> = {
  motor: "Motor", transformer: "Transformer", pump: "Pump", generator: "Generator", panel: "Panel",
};
const KIND_TONE: Record<string, PillarKey> = {
  motor: "blue", transformer: "purple", pump: "teal", generator: "amber", panel: "green",
};

const ALL_KINDS = ["motor", "transformer", "pump", "generator", "panel"] as const;

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string; sort?: string; dir?: string; page?: string; af?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("assets");
  await requireFeature("assets");
  const params = await searchParams;
  const { kind: kindFilter, q, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const { customerAssets: allCustomerAssets, loanerStock } = await listAssetsLive();

  let customerAssets = kindFilter && kindFilter !== "loaner"
    ? allCustomerAssets.filter((r) => r.asset.kind === kindFilter)
    : allCustomerAssets;

  if (q) {
    const term = q.toLowerCase();
    customerAssets = customerAssets.filter((r) =>
      r.asset.name.toLowerCase().includes(term) ||
      (r.asset.make ?? "").toLowerCase().includes(term) ||
      (r.asset.model ?? "").toLowerCase().includes(term) ||
      (r.asset.serial ?? "").toLowerCase().includes(term) ||
      (r.account?.name ?? "").toLowerCase().includes(term)
    );
  }

  customerAssets = applyAdvancedFilter(customerAssets, af, (r) => r.asset as unknown as Record<string, unknown>);
  customerAssets = applyColFilters(customerAssets, colFilters, SORT_EXTRACTORS);
  customerAssets = sortRows(customerAssets, sort, dir, SORT_EXTRACTORS);
  const pageAssets = paginate(customerAssets, page);

  const available = loanerStock.filter((r) => r.asset.loaner_status === "available").length;
  const onLoan    = loanerStock.filter((r) => r.asset.loaner_status === "on_loan").length;

  const columns: ListColumn<AssetRow>[] = [
    {
      id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden",
      cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" },
      render: ({ asset }) => asset.ref ?? "—",
    },
    {
      id: "name", label: "Asset", sortKey: "name", card: "title",
      render: ({ asset }) => {
        const p = pillar[KIND_TONE[asset.kind] ?? "blue"];
        return (
          <Link href={ROUTES.asset(asset.id)} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: p.bg, color: p.fg,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <KindIcon kind={asset.kind} size={15} color={p.fg} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{asset.name}</div>
              {asset.rating && <div style={{ fontSize: 11.5, color: c.hint, marginTop: 1, fontWeight: 400 }}>{asset.rating}</div>}
            </div>
          </Link>
        );
      },
    },
    { id: "kind", label: "Type", sortKey: "kind", cellStyle: { color: c.muted }, render: ({ asset }) => KIND_LABEL[asset.kind] ?? asset.kind },
    { id: "make", label: "Make / Model", sortKey: "make", cellStyle: { color: c.muted }, render: ({ asset }) => [asset.make, asset.model].filter(Boolean).join(" · ") || "—" },
    { id: "serial", label: "Serial", sortKey: "serial", cellStyle: { fontFamily: "monospace", fontSize: 12, color: c.muted }, render: ({ asset }) => asset.serial ?? "—" },
    {
      id: "account", label: "Account", sortKey: "account",
      render: ({ account }) => account
        ? <Link href={ROUTES.account(account.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 500 }}>{account.name}</Link>
        : <span style={{ color: c.hint }}>—</span>,
    },
    {
      id: "cases", label: "Open cases", sortKey: "cases",
      render: ({ openCaseCount }) => openCaseCount > 0
        ? <Link href={ROUTES.cases} style={{ textDecoration: "none" }}><StatusPill label={`${openCaseCount} case${openCaseCount > 1 ? "s" : ""}`} tone="teal" /></Link>
        : <span style={{ color: c.line }}>—</span>,
    },
  ];

  const loanerStockCard = (
    <section style={{ ...CARD_SURFACE, padding: 16, marginBottom: 14, display: kindFilter && kindFilter !== "loaner" ? "none" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: c.ink }}>Loaner Stock</h2>
        <StatusPill label={`${onLoan} on loan`} tone="amber" />
        <StatusPill label={`${available} available`} tone="teal" />
      </div>

      {loanerStock.length === 0 ? (
        <p style={{ color: c.muted, fontSize: 13, margin: 0 }}>No loaner units in stock.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {loanerStock.map(({ asset, loanedToCase, loanedToAccount }) => {
            const isOnLoan = asset.loaner_status === "on_loan";
            const tone = isOnLoan ? pillar.amber : pillar.teal;
            return (
              <div key={asset.id} style={{
                border: `1px solid ${tone.base}44`,
                borderTop: `3px solid ${tone.base}`,
                borderRadius: 10,
                padding: "12px 14px",
                background: `color-mix(in srgb, ${tone.bg} 27%, transparent)`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <KindIcon kind={asset.kind} size={18} color={tone.base} />
                  <StatusPill label={isOnLoan ? "On Loan" : "Available"} tone={isOnLoan ? "amber" : "teal"} />
                  {asset.serial && (
                    <span style={{ fontSize: 10, color: c.hint, fontFamily: "monospace", marginLeft: "auto" }}>{asset.serial}</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{asset.name}{asset.ref && <span style={{ fontWeight: 400, fontSize: 10.5, color: c.hint, fontFamily: "monospace", marginLeft: 6 }}>{asset.ref}</span>}</span>
                  <Link
                    href={ROUTES.asset(asset.id)}
                    style={{ fontSize: 11, fontWeight: 600, color: tone.base, textDecoration: "none", flexShrink: 0, whiteSpace: "nowrap" }}
                  >
                    View →
                  </Link>
                </div>
                {asset.rating && (
                  <div style={{ fontSize: 11.5, color: c.muted, marginBottom: 8 }}>{asset.rating}</div>
                )}
                {isOnLoan && loanedToCase && loanedToAccount ? (
                  <div style={{ fontSize: 11.5, borderTop: `1px solid ${tone.base}44`, paddingTop: 8, marginTop: 4 }}>
                    <div style={{ color: c.muted, marginBottom: 3 }}>Currently with:</div>
                    <Link
                      href={ROUTES.account(loanedToAccount.id)}
                      style={{ color: c.accent, fontWeight: 600, textDecoration: "none", fontSize: 12.5 }}
                    >
                      {loanedToAccount.name}
                    </Link>
                    <div style={{ marginTop: 3 }}>
                      <Link
                        href={ROUTES.case(loanedToCase.id)}
                        style={{ fontSize: 11, color: pillar.teal.base, fontFamily: "monospace", textDecoration: "none" }}
                      >
                        {loanedToCase.ref}
                      </Link>
                    </div>
                  </div>
                ) : !isOnLoan ? (
                  <div style={{ fontSize: 11, color: pillar.teal.base, fontWeight: 500, marginTop: 4 }}>
                    Ready for dispatch
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const hasFilter = !!(q || af || (kindFilter && kindFilter !== "loaner") || Object.keys(cfParams).length > 0);

  return (
    <ObjectListPage
      title="Assets"
      subtitle={`${customerAssets.length}${kindFilter && kindFilter !== "loaner" ? ` ${KIND_LABEL[kindFilter] ?? kindFilter}` : ""} of ${allCustomerAssets.length} customer assets · ${loanerStock.length} loaner units (${available} available)`}
      newLabel="Asset"
      newHref={ROUTES.assetNew}
      search={{
        value: q,
        placeholder: "Search name, make, model, serial or account…",
        selects: [{
          name: "kind", value: kindFilter, placeholder: "All types",
          options: [
            ...ALL_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
            { value: "loaner", label: "Loaner stock" },
          ],
        }],
        hiddenParams: { af, ...cfParams },
      }}
      advancedFilterObject="asset"
      beforeTable={loanerStockCard}
      columns={columns}
      rows={pageAssets}
      rowKey={({ asset }) => asset.id}
      rowHref={({ asset }) => ROUTES.asset(asset.id)}
      total={customerAssets.length}
      page={page}
      baseHref={ROUTES.assets}
      sort={sort}
      dir={dir}
      linkParams={{ kind: kindFilter, q, af, ...cfParams }}
      filtered={hasFilter}
      empty={{
        title: "No customer assets registered",
        text: "Register the equipment your customers own so service cases and quotes can point at it.",
        filteredTitle: "No customer assets match these filters.",
      }}
    />
  );
}
