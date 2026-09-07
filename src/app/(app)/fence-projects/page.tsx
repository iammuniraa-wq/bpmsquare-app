import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import Pill from "@/components/Pill";
import type { FenceProject } from "@/lib/types";

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

const STATUS_TONE: Record<FenceProject["status"], "green" | "amber" | "blue" | "red"> = {
  draft: "amber",
  quoted: "blue",
  won: "green",
  lost: "red",
};

export default async function FenceProjectsPage() {
  await requireWorkcenterView("fence_projects");
  await requireFeature("fence_projects");
  const { supabase, tenantId } = await requireTenantUser();

  const { data: rows, error } = await supabase
    .from("fence_projects")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  const projects: FenceProject[] = error ? [] : (rows ?? []); // 42P01 = migration pending -- empty, never a crash

  const accountIds = [...new Set(projects.map((p) => p.account_id).filter((x): x is string => !!x))];
  const { data: accountRows } = accountIds.length > 0
    ? await supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds)
    : { data: [] };
  const accountNames: Record<string, string> = Object.fromEntries((accountRows ?? []).map((a) => [a.id as string, a.name as string]));

  return (
    <>
      <TabTitle title="Fence Projects" />
      <PageHeader
        title="Fence Projects"
        subtitle={`${projects.length} total`}
        action={
          <Link
            href={ROUTES.fenceProjectNew}
            style={{ padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: c.accent, color: "#fff", textDecoration: "none" }}
          >
            + New Fence Project
          </Link>
        }
      />

      <div style={{ ...cardStyle, overflow: "hidden" }}>
        {projects.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
            No fence projects yet.
            <div style={{ marginTop: 12 }}>
              <Link href={ROUTES.fenceProjectNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                + Configure your first fence
              </Link>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                  <th style={{ ...th, width: 88 }}>ID</th>
                  <th style={th}>Name</th>
                  <th style={th}>Account</th>
                  <th style={th}>Layout</th>
                  <th style={th}>Length</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }}>{p.ref ?? "—"}</td>
                    <td style={td}>
                      <Link href={ROUTES.fenceProject(p.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>
                        {p.name}
                      </Link>
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 13 }}>{p.account_id ? (accountNames[p.account_id] ?? "—") : "—"}</td>
                    <td style={{ ...td, color: c.muted, fontSize: 13 }}>{p.layout === "closed_perimeter" ? "Closed perimeter" : "Open run"}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{p.total_length_m} m</td>
                    <td style={td}>
                      <Pill label={p.status[0].toUpperCase() + p.status.slice(1)} tone={STATUS_TONE[p.status]} />
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <Link href={ROUTES.fenceProject(p.id)} style={{
                        fontSize: 11.5, fontWeight: 600, color: c.accent,
                        background: c.accentbg, borderRadius: 6, padding: "4px 10px",
                        textDecoration: "none", whiteSpace: "nowrap",
                      }}>
                        Open in Fence Design Studio →
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
