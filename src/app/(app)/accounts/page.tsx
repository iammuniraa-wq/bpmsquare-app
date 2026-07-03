import Link from "next/link";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data";
import { listAccountsLive } from "@/lib/data/live";
import type { Account } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ViewToggle from "@/components/ViewToggle";
import { ROUTES } from "@/lib/constants";
import { MapPin } from "@/components/Icons";
import type { PillarKey } from "@/lib/theme";

const typeTone: Record<Account["type"], PillarKey> = {
  prospect:     "amber",
  oem:          "purple",
  direct:       "green",
  end_customer: "teal",
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: 8, borderBottom: `1px solid ${c.line}`, fontSize: 12,
};
const td: React.CSSProperties = {
  padding: "11px 8px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const isCard = view !== "list";
  const rows = await listAccountsLive();

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={`${rows.length} accounts · the hub everything points to`}
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              href={ROUTES.accountNew}
              style={{
                padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                background: c.accent, color: "#fff", textDecoration: "none",
              }}
            >
              + New Account
            </Link>
            <ViewToggle />
          </div>
        }
      />

      {isCard ? (
        // ── Card grid ──────────────────────────────────────────────────────────
        <div className="card-grid">
          {rows.map(({ account, referredBy, counts }) => {
            const connected = counts.contacts + counts.assets + counts.contracts + counts.quotes + counts.workOrders + counts.invoices;
            const tone = typeTone[account.type];
            const p = pillar[tone];
            return (
              <Link
                key={account.id}
                href={ROUTES.account(account.id)}
                style={{
                  ...cardStyle, textDecoration: "none",
                  display: "flex", flexDirection: "column", gap: 12,
                  borderTop: `3px solid ${p.base}`,
                  transition: "box-shadow .15s",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: p.bg, color: p.fg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700,
                  }}>
                    {initials(account.name)}
                  </div>
                  <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={tone} />
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>{account.name}</div>
                  {account.city && (
                    <div style={{ fontSize: 12, color: c.muted, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}><MapPin size={11} color={c.hint} /> {account.city}</div>
                  )}
                  {referredBy && (
                    <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>via {referredBy.name}</div>
                  )}
                </div>

                <div style={{
                  marginTop: "auto", paddingTop: 10,
                  borderTop: `1px solid ${c.line}`,
                  fontSize: 11.5, color: c.hint,
                  display: "flex", gap: 10,
                }}>
                  <span>{counts.contacts} contacts</span>
                  <span>{counts.assets} assets</span>
                  <span>{connected} records</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        // ── List / table ───────────────────────────────────────────────────────
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Account</th>
                <th style={th}>Type</th>
                <th style={th}>City</th>
                <th style={th}>Referred by</th>
                <th style={{ ...th, textAlign: "right" }}>Records</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account, referredBy, counts }) => {
                const connected = counts.contacts + counts.assets + counts.contracts + counts.quotes + counts.workOrders + counts.invoices;
                return (
                  <tr key={account.id}>
                    <td style={td}>
                      <Link href={ROUTES.account(account.id)} style={{ fontWeight: 600, color: c.accent }}>
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
      )}
    </>
  );
}
