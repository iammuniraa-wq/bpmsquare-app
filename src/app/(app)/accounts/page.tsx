import Link from "next/link";
import { listAccounts, ACCOUNT_TYPE_LABEL } from "@/lib/data";
import type { Account } from "@/lib/types";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { PillarKey } from "@/lib/theme";

const typeTone: Record<Account["type"], PillarKey> = {
  prospect:     "amber",
  oem:          "purple",
  direct:       "green",
  end_customer: "teal",
};

const th: React.CSSProperties = {
  textAlign: "left",
  color: c.hint,
  fontWeight: 500,
  padding: 8,
  borderBottom: `1px solid ${c.line}`,
  fontSize: 12,
};
const td: React.CSSProperties = {
  padding: "11px 8px",
  borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5,
  verticalAlign: "middle",
};

export default async function AccountsPage() {
  const rows = await listAccounts();

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={`Records · ${rows.length} accounts · the hub everything points to`}
      />
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Account</th>
              <th style={th}>Type</th>
              <th style={th}>City</th>
              <th style={th}>Referred by</th>
              <th style={{ ...th, textAlign: "right" }}>Connected records</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ account, referredBy, counts }) => {
              const connected =
                counts.contacts +
                counts.assets +
                counts.contracts +
                counts.quotes +
                counts.workOrders +
                counts.invoices;
              return (
                <tr key={account.id}>
                  <td style={td}>
                    <Link
                      href={ROUTES.account(account.id)}
                      style={{ fontWeight: 600, color: c.accent }}
                    >
                      {account.name}
                    </Link>
                  </td>
                  <td style={td}>
                    <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={typeTone[account.type]} />
                  </td>
                  <td style={{ ...td, color: c.muted }}>{account.city ?? "—"}</td>
                  <td style={{ ...td, color: c.muted }}>{referredBy?.name ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right", color: c.muted }}>{connected}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
