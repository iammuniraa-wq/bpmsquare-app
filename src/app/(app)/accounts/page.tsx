import Link from "next/link";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data";
import { listAccountsLive } from "@/lib/data/live";
import type { Account } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import { MapPin } from "@/components/Icons";
import type { PillarKey } from "@/lib/theme";

const typeTone: Record<Account["type"], PillarKey> = {
  prospect:     "amber",
  oem:          "purple",
  direct:       "green",
  end_customer: "teal",
};

const ALL_TYPES: Account["type"][] = ["prospect", "oem", "direct", "end_customer"];

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { q, type: typeFilter } = await searchParams;
  const allRows = await listAccountsLive();

  // Filter server-side from searchParams
  const rows = allRows.filter(({ account }) => {
    const matchQ = !q || account.name.toLowerCase().includes(q.toLowerCase());
    const matchType = !typeFilter || account.type === typeFilter;
    return matchQ && matchType;
  });

  const totalConnected = (counts: typeof rows[0]["counts"]) =>
    counts.contacts + counts.assets + counts.contracts + counts.quotes + counts.workOrders + counts.invoices;

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={`${allRows.length} account${allRows.length !== 1 ? "s" : ""}`}
        action={
          <Link
            href={ROUTES.accountNew}
            style={{
              padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + New Account
          </Link>
        }
      />

      {/* ── Search + type filter ─────────────────────────────────────────── */}
      <form method="GET" style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="Search accounts…"
          autoComplete="off"
          style={{
            flex: "1 1 220px", padding: "8px 12px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13.5, color: c.ink,
            background: "#fff", outline: "none",
          }}
        />
        {/* Type filter pills — submit on click via hidden input */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Link
            href={ROUTES.accounts + (q ? `?q=${encodeURIComponent(q)}` : "")}
            style={{
              padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
              background: !typeFilter ? c.accent : c.panel2,
              color: !typeFilter ? "#fff" : c.muted,
              textDecoration: "none", border: `1px solid ${!typeFilter ? c.accent : c.line}`,
            }}
          >
            All
          </Link>
          {ALL_TYPES.map((t) => {
            const active = typeFilter === t;
            const p = pillar[typeTone[t]];
            return (
              <Link
                key={t}
                href={`${ROUTES.accounts}?${q ? `q=${encodeURIComponent(q)}&` : ""}type=${t}`}
                style={{
                  padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                  background: active ? p.base : c.panel2,
                  color: active ? "#fff" : c.muted,
                  textDecoration: "none", border: `1px solid ${active ? p.base : c.line}`,
                }}
              >
                {ACCOUNT_TYPE_LABEL[t]}
              </Link>
            );
          })}
        </div>
      </form>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
            {q || typeFilter ? "No accounts match this filter." : "No accounts yet."}
            {!q && !typeFilter && (
              <div style={{ marginTop: 12 }}>
                <Link href={ROUTES.accountNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                  + Create your first account
                </Link>
              </div>
            )}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: c.panel2, borderBottom: `1px solid ${c.line}` }}>
                <th style={th}>Account</th>
                <th style={th}>Type</th>
                <th style={th}>City</th>
                <th style={{ ...th, textAlign: "center" }}>Contacts</th>
                <th style={{ ...th, textAlign: "center" }}>Cases</th>
                <th style={{ ...th, textAlign: "center" }}>Assets</th>
                <th style={{ ...th, textAlign: "right" }}>Records</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account, referredBy, counts }, i) => {
                const tone = typeTone[account.type];
                const p = pillar[tone];
                const odd = i % 2 === 1;
                return (
                  <tr
                    key={account.id}
                    style={{ background: odd ? c.panel2 : "#fff", borderBottom: `1px solid ${c.line}` }}
                  >
                    {/* Account name + avatar */}
                    <td style={td}>
                      <Link
                        href={ROUTES.account(account.id)}
                        style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                          background: p.bg, color: p.fg,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11.5, fontWeight: 700,
                        }}>
                          {initials(account.name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{account.name}</div>
                          {referredBy && (
                            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 1 }}>via {referredBy.name}</div>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td style={td}>
                      <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={tone} />
                    </td>
                    <td style={{ ...td, color: c.muted }}>
                      {account.city ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <MapPin size={11} color={c.hint} /> {account.city}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "center", color: c.muted }}>{counts.contacts || "—"}</td>
                    <td style={{ ...td, textAlign: "center", color: c.muted }}>{counts.quotes || "—"}</td>
                    <td style={{ ...td, textAlign: "center", color: c.muted }}>{counts.assets || "—"}</td>
                    <td style={{ ...td, textAlign: "right", color: c.hint, fontWeight: 500 }}>
                      {totalConnected(counts)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Result count */}
      {(q || typeFilter) && rows.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: c.hint }}>
          {rows.length} result{rows.length !== 1 ? "s" : ""}
          {" · "}
          <Link href={ROUTES.accounts} style={{ color: c.accent, textDecoration: "none" }}>Clear filter</Link>
        </div>
      )}
    </>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "10px 14px", fontSize: 11.5, letterSpacing: 0.3,
  textTransform: "uppercase", whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "12px 14px", fontSize: 13.5, verticalAlign: "middle",
};
