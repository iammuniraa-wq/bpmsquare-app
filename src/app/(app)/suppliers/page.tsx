import Link from "next/link";
import { requireTenantUser } from "@/lib/supabase-server";
import type { Supplier } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";

const TYPE_LABEL: Record<Supplier["type"], string> = {
  vendor: "Vendor", subcontractor: "Subcontractor", both: "Vendor & Sub",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { supabase, tenantId } = await requireTenantUser();
  const { q, type: typeFilter } = await searchParams;

  let query = supabase.from("suppliers").select("*").eq("tenant_id", tenantId).order("name");
  if (typeFilter && typeFilter !== "all") query = query.eq("type", typeFilter);

  const { data: rows } = await query;
  const suppliers: Supplier[] = rows ?? [];

  const filtered = suppliers.filter((s) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      s.name.toLowerCase().includes(term) ||
      (s.city ?? "").toLowerCase().includes(term) ||
      (s.email ?? "").toLowerCase().includes(term) ||
      (s.gstin ?? "").toLowerCase().includes(term)
    );
  });

  const active   = suppliers.filter((s) => s.status === "active").length;
  const inactive = suppliers.filter((s) => s.status === "inactive").length;

  const filterHref = (t: string) =>
    `${ROUTES.suppliers}?type=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle={`${suppliers.length} total · ${active} active`}
        action={
          <Link
            href={ROUTES.supplierNew}
            style={{
              padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + Add Supplier
          </Link>
        }
      />

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { id: "all",           label: `All (${suppliers.length})` },
          { id: "vendor",        label: `Vendors` },
          { id: "subcontractor", label: `Subcontractors` },
          { id: "both",          label: `Both` },
        ].map(({ id, label }) => {
          const active2 = (typeFilter ?? "all") === id;
          return (
            <Link key={id} href={filterHref(id)} style={{
              fontSize: 12.5, fontWeight: active2 ? 700 : 500,
              color: active2 ? c.accent : c.muted,
              background: active2 ? c.accentbg : c.panel2,
              border: `1px solid ${active2 ? c.accent + "60" : c.line}`,
              borderRadius: 6, padding: "5px 12px", textDecoration: "none",
            }}>
              {label}
            </Link>
          );
        })}
        {inactive > 0 && (
          <Link href={`${ROUTES.suppliers}?type=inactive`} style={{
            fontSize: 12.5, color: c.hint, background: c.panel2,
            border: `1px solid ${c.line}`, borderRadius: 6, padding: "5px 12px", textDecoration: "none",
          }}>
            Inactive ({inactive})
          </Link>
        )}
      </div>

      {/* Search */}
      <form method="GET" style={{ marginBottom: 14 }}>
        {typeFilter && typeFilter !== "all" && <input type="hidden" name="type" value={typeFilter} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name, city, email or GSTIN…"
          autoComplete="off"
          style={{
            width: "100%", maxWidth: 420, padding: "8px 12px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13.5, color: c.ink,
            background: "#fff", outline: "none",
          }}
        />
        {q && (
          <Link href={ROUTES.suppliers} style={{ marginLeft: 10, fontSize: 12, color: c.hint, textDecoration: "none" }}>
            Clear ✕
          </Link>
        )}
      </form>

      {/* Table */}
      <div style={{ ...cardStyle, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
            {q ? `No suppliers match "${q}".` : "No suppliers yet."}
            {!q && (
              <div style={{ marginTop: 12 }}>
                <Link href={ROUTES.supplierNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                  + Add your first supplier
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                  <th style={th}>Name</th>
                  <th style={th}>Type</th>
                  <th style={th}>City</th>
                  <th style={th}>Phone</th>
                  <th style={th}>GSTIN</th>
                  <th style={th}>Status</th>
                  <th style={th}>Added</th>
                  <th style={{ ...th, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <td style={td}>
                      <Link href={ROUTES.supplier(s.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>
                        {s.name}
                      </Link>
                      {s.email && <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{s.email}</div>}
                    </td>
                    <td style={td}>
                      <Pill
                        label={TYPE_LABEL[s.type]}
                        tone={s.type === "vendor" ? "blue" : s.type === "subcontractor" ? "amber" : "teal"}
                      />
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 13 }}>{s.city ?? "—"}</td>
                    <td style={{ ...td, color: c.muted, fontSize: 13 }}>{s.phone ?? "—"}</td>
                    <td style={{ ...td, color: c.muted, fontSize: 12, fontFamily: "monospace" }}>{s.gstin ?? "—"}</td>
                    <td style={td}>
                      <Pill label={s.status === "active" ? "Active" : "Inactive"} tone={s.status === "active" ? "green" : "red"} />
                    </td>
                    <td style={{ ...td, color: c.hint, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(s.created_at)}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <Link href={ROUTES.supplier(s.id)} style={{
                        fontSize: 11.5, fontWeight: 600, color: c.accent,
                        background: c.accentbg, borderRadius: 6, padding: "4px 10px",
                        textDecoration: "none", whiteSpace: "nowrap",
                      }}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
