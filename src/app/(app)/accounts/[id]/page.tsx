import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccountHub, ACCOUNT_TYPE_LABEL } from "@/lib/data";
import type { Activity } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";

const activityTone: Record<Activity["pillar"], PillarKey> = {
  marketing: "purple",
  sales: "blue",
  service: "teal",
  field: "amber",
  finance: "green",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function AccountHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const hub = await getAccountHub(id);
  if (!hub) notFound();

  const { account, referredBy } = hub;

  // Connected-object chips — the hub's reach at a glance.
  const chips = [
    { label: "Contacts", n: hub.contacts.length },
    { label: "Assets", n: hub.assets.length },
    { label: "Quotes", n: hub.quotes.length },
    { label: "Work orders", n: hub.workOrders.length },
    { label: "Contract", n: hub.contracts.length },
    { label: "Invoices", n: hub.invoices.length },
  ];

  return (
    <>
      <PageHeader
        title={account.name}
        subtitle={`${ACCOUNT_TYPE_LABEL[account.type]}${account.city ? " · " + account.city : ""}`}
      />

      <div style={{ marginBottom: 14 }}>
        <Link href={ROUTES.accounts} style={{ fontSize: 12, color: c.muted }}>
          ← All accounts
        </Link>
      </div>

      {/* Connected-object chips */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {chips.map((chip) => (
          <div
            key={chip.label}
            style={{
              background: c.panel,
              border: `1px solid ${c.line}`,
              borderRadius: 10,
              padding: "12px 10px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 600, color: c.ink }}>{chip.n}</div>
            <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>{chip.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 12 }} className="hub-grid">
        {/* Left column — details + connected records */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 12px", fontWeight: 600 }}>Account</h3>
            <Detail label="Type" value={ACCOUNT_TYPE_LABEL[account.type]} />
            {referredBy && (
              <Detail
                label="Referred by"
                value={
                  <Link href={ROUTES.account(referredBy.id)} style={{ color: c.accent }}>
                    {referredBy.name}
                  </Link>
                }
              />
            )}
            <Detail label="Phone" value={account.phone ?? "—"} />
            <Detail label="Email" value={account.email ?? "—"} />
            <Detail label="Since" value={fmtDate(account.created_at)} />
          </section>

          {hub.assets.length > 0 && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Assets</h3>
              {hub.assets.map((a) => (
                <div key={a.id} style={{ padding: "7px 0", borderTop: `1px solid ${c.line}` }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{a.name}</div>
                  <div style={{ fontSize: 11.5, color: c.muted }}>
                    {a.kind} · {a.rating ?? ""} {a.serial ? "· " + a.serial : ""}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Work orders — each shows its authorizing wrapper (the model's spine) */}
          {hub.workOrders.length > 0 && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Work orders</h3>
              {hub.workOrders.map((wo) => {
                const wrapper =
                  wo.authorized_by.kind === "quote"
                    ? { text: "Quote " + wo.authorized_by.id.replace(/^qt_/, "").toUpperCase(), tone: "blue" as PillarKey }
                    : { text: "AMC contract", tone: "teal" as PillarKey };
                return (
                  <div key={wo.id} style={{ padding: "9px 0", borderTop: `1px solid ${c.line}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{wo.ref}</span>
                      <Pill label={wo.status.replace("_", " ")} tone="amber" />
                    </div>
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 4 }}>
                      {wo.asset?.name ?? "—"}
                      {wo.technician ? " · " + wo.technician.name : ""}
                    </div>
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>
                      Authorized by <Pill label={wrapper.text} tone={wrapper.tone} />
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>

        {/* Right column — unified timeline across pillars */}
        <section style={cardStyle}>
          <h3 style={{ fontSize: 13, margin: "0 0 14px", fontWeight: 600 }}>
            Timeline — one job across the pillars
          </h3>
          {hub.activities.length === 0 && (
            <div style={{ fontSize: 12.5, color: c.muted }}>No activity yet.</div>
          )}
          {hub.activities.map((act, i) => {
            const tone = pillar[activityTone[act.pillar]];
            const last = i === hub.activities.length - 1;
            return (
              <div key={act.id} style={{ display: "flex", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      marginTop: 5,
                      background: tone.base,
                    }}
                  />
                  {!last && <div style={{ flex: 1, width: 1.5, background: c.line }} />}
                </div>
                <div style={{ paddingBottom: 14, fontSize: 12.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Pill label={act.pillar} tone={activityTone[act.pillar]} />
                    <span style={{ color: c.hint, fontSize: 11 }}>{fmtDate(act.at)}</span>
                  </div>
                  <div style={{ marginTop: 4 }}>{act.text}</div>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}
