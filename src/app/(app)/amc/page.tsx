import { requireFeature } from "@/lib/tenant";
import { listContracts } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";

type ContractStatus = "active" | "expired" | "pending" | "cancelled";

const STATUS_TONE: Record<ContractStatus, PillarKey> = {
  active: "green", expired: "red", pending: "amber", cancelled: "red",
};
const STATUS_LABEL: Record<ContractStatus, string> = {
  active: "Active", expired: "Expired", pending: "Pending", cancelled: "Cancelled",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function daysLeft(endDate: string | null): number {
  if (!endDate) return 0;
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
}

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

export default async function AmcPage() {
  await requireFeature("amc");
  const contracts = await listContracts();
  const active = contracts.filter((con) => con.status === "active");
  const expiringSoon = active.filter((con) => daysLeft(con.end_date) <= 60);
  const totalValue = active.reduce((s, con) => s + (con.value ?? 0), 0);

  return (
    <>
      <PageHeader title="AMC Contracts" subtitle={`${contracts.length} total · Annual Maintenance Contracts`} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Active</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: pillar.green.base }}>{active.length}</div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Expiring ≤60 days</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: expiringSoon.length > 0 ? pillar.amber.base : pillar.green.base }}>{expiringSoon.length}</div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Active Value</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: pillar.teal.base }}>{inr(totalValue)}</div>
        </div>
      </div>

      {contracts.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: c.muted }}>
          No AMC contracts yet.
        </div>
      ) : (
        <div style={cardStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Ref</th>
                <th style={th}>Account</th>
                <th style={th}>Status</th>
                <th style={th}>Period</th>
                <th style={th}>Days left</th>
                <th style={th}>Value</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((con) => {
                const left = daysLeft(con.end_date);
                const isExpiringSoon = con.status === "active" && left <= 60;
                return (
                  <tr key={con.id}>
                    <td style={td}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: c.accent, fontWeight: 600 }}>
                        {con.ref}
                      </span>
                    </td>
                    <td style={td}>{con.account_name}</td>
                    <td style={td}>
                      <Pill
                        label={STATUS_LABEL[con.status as ContractStatus] ?? con.status}
                        tone={STATUS_TONE[con.status as ContractStatus] ?? "blue"}
                      />
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 11.5 }}>
                      {fmtDate(con.start_date)} – {fmtDate(con.end_date)}
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: isExpiringSoon ? pillar.amber.base : c.ink }}>
                      {con.status === "active" ? (left > 0 ? `${left}d` : "Expired") : "—"}
                    </td>
                    <td style={{ ...td, fontWeight: 700 }}>{con.value ? inr(con.value) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
