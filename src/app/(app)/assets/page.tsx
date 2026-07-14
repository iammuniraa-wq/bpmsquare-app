import Link from "next/link";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import { listAssetsLive } from "@/lib/data/live";
import { Zap, Gear, Droplet, Battery, Monitor, Activity } from "@/components/Icons";

function KindIcon({ kind, size = 18, color }: { kind: string; size?: number; color?: string }) {
  const p = { size, color: color ?? "currentColor" };
  switch (kind) {
    case "motor":       return <Zap {...p} />;
    case "transformer": return <Gear {...p} />;
    case "pump":        return <Droplet {...p} />;
    case "generator":   return <Battery {...p} />;
    case "panel":       return <Monitor {...p} />;
    default:            return <Activity {...p} />;
  }
}
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
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind: kindFilter } = await searchParams;
  const { customerAssets: allCustomerAssets, loanerStock } = await listAssetsLive();

  const customerAssets = kindFilter && kindFilter !== "loaner"
    ? allCustomerAssets.filter((r) => r.asset.kind === kindFilter)
    : allCustomerAssets;

  const available = loanerStock.filter((r) => r.asset.loaner_status === "available").length;
  const onLoan    = loanerStock.filter((r) => r.asset.loaner_status === "on_loan").length;

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle={`${customerAssets.length}${kindFilter && kindFilter !== "loaner" ? ` ${KIND_LABEL[kindFilter] ?? kindFilter}` : ""} of ${allCustomerAssets.length} customer assets · ${loanerStock.length} loaner units (${available} available)`}
        action={
          <Link
            href={ROUTES.assetNew}
            style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + New Asset
          </Link>
        }
      />

      {/* Kind filter — dropdown */}
      <form method="GET" style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <select
          name="kind"
          defaultValue={kindFilter ?? ""}
          style={{
            padding: "7px 10px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13, color: kindFilter ? c.ink : c.hint,
            background: "#fff", outline: "none", cursor: "pointer",
          }}
        >
          <option value="">All types</option>
          {ALL_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
          <option value="loaner">Loaner stock</option>
        </select>
        <button
          type="submit"
          style={{
            padding: "7px 14px", borderRadius: 7, border: "none",
            background: c.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          Filter
        </button>
        {kindFilter && (
          <Link href={ROUTES.assets} style={{ fontSize: 12, color: c.hint, textDecoration: "none" }}>
            Clear ✕
          </Link>
        )}
      </form>

      {/* Loaner Stock */}
      <section style={{ ...cardStyle, marginBottom: 14, display: kindFilter && kindFilter !== "loaner" ? "none" : undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: c.ink }}>Loaner Stock</h2>
          <span style={{ fontSize: 12, background: pillar.amber.bg, color: pillar.amber.base, borderRadius: 5, padding: "2px 8px", fontWeight: 600 }}>
            {onLoan} on loan
          </span>
          <span style={{ fontSize: 12, background: pillar.teal.bg, color: pillar.teal.base, borderRadius: 5, padding: "2px 8px", fontWeight: 600 }}>
            {available} available
          </span>
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
                  background: tone.bg + "44",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <KindIcon kind={asset.kind} size={18} color={tone.base} />
                    <Pill label={isOnLoan ? "On Loan" : "Available"} tone={isOnLoan ? "amber" : "teal"} />
                    {asset.serial && (
                      <span style={{ fontSize: 10, color: c.hint, fontFamily: "monospace", marginLeft: "auto" }}>{asset.serial}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: c.ink, marginBottom: 3 }}>{asset.name}</div>
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

      {/* Customer Assets */}
      <section style={cardStyle}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px", color: c.ink }}>
          Customer Assets
          <span style={{ fontSize: 12, fontWeight: 400, color: c.muted, marginLeft: 8 }}>
            {customerAssets.length} registered
          </span>
        </h2>

        {customerAssets.length === 0 ? (
          <p style={{ color: c.muted, fontSize: 13, margin: 0 }}>No customer assets registered.</p>
        ) : (
          customerAssets.map(({ asset, account, openCaseCount }, i) => {
            const tone = KIND_TONE[asset.kind] ?? "blue";
            return (
              <div
                key={asset.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 0", borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  background: pillar[tone].bg, color: pillar[tone].fg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <KindIcon kind={asset.kind} size={16} color={pillar[tone].fg} />
                </div>

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: c.ink, marginBottom: 2 }}>
                    {asset.name}
                  </div>
                  {(asset.make || asset.model) && (
                    <div style={{ fontSize: 12, color: c.muted, marginBottom: 2 }}>
                      {[asset.make, asset.model].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: c.hint, marginBottom: 3 }}>
                    {KIND_LABEL[asset.kind] ?? asset.kind}
                    {asset.rating ? " · " + asset.rating : ""}
                    {asset.serial ? (
                      <span style={{ fontFamily: "monospace" }}> · {asset.serial}</span>
                    ) : null}
                  </div>
                  {account && (
                    <Link
                      href={ROUTES.account(account.id)}
                      style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 500 }}
                    >
                      {account.name}
                    </Link>
                  )}
                  {asset.notes && (
                    <div style={{ fontSize: 10.5, color: c.hint, marginTop: 3, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {asset.notes}
                    </div>
                  )}
                </div>

                {/* Open cases badge */}
                {openCaseCount > 0 && (
                  <Link
                    href={ROUTES.cases}
                    style={{
                      fontSize: 11, fontWeight: 600, color: pillar.teal.base,
                      background: pillar.teal.bg, borderRadius: 6, padding: "3px 8px",
                      textDecoration: "none", flexShrink: 0, whiteSpace: "nowrap",
                    }}
                  >
                    {openCaseCount} case{openCaseCount > 1 ? "s" : ""}
                  </Link>
                )}
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
