import Link from "next/link";
import { createAdminSupabase, isPlatformAdmin } from "@/lib/supabase-server";
import { loadNotifyAddress } from "@/lib/studio/server";
import { STUDY_STATUS_LABEL, type StudyStatus } from "@/lib/studio/types";
import NotifySettings from "./NotifySettings";

// Every study across tenants and the Talk to us queue. This is the one place
// studies are read across tenants (docs/process-design-studio-architecture.md
// section 6.8), behind isPlatformAdmin() like /admin/tenants.

type Row = {
  id: string; tenant_id: string; ref: string | null; name: string; status: StudyStatus; current_version: number; updated_at: string;
  reviewed_at: string | null; tenants: { name: string } | { name: string }[] | null;
};

const th: React.CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#6b7280", background: "#f9fafb", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, borderTop: "1px solid #eef0f3", verticalAlign: "top" };

export default async function AdminStudiesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  if (!(await isPlatformAdmin())) return null;
  const { filter } = await searchParams;
  const admin = createAdminSupabase();
  const { data, error } = await admin.from("process_studies")
    .select("id, tenant_id, ref, name, status, current_version, updated_at, reviewed_at, tenants(name)")
    .order("updated_at", { ascending: false }).limit(300);
  const notify = await loadNotifyAddress();

  if (error) {
    const pending = error.code === "42P01" || error.code === "PGRST205";
    return (
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Studies</h1>
        <p style={{ color: "#6b7280" }}>{pending ? "Waiting for migration 0152 (process_studio) on this database." : error.message}</p>
      </div>
    );
  }

  const studies = (data ?? []) as unknown as Row[];
  const ids = studies.map((s) => s.id);
  const [fit, reqs] = ids.length
    ? await Promise.all([
        admin.from("process_study_fit").select("study_id, warnings, rating").in("study_id", ids).limit(10000),
        admin.from("process_study_requests").select("study_id, status, version, created_at").in("study_id", ids).order("created_at", { ascending: false }).limit(2000),
      ])
    : [{ data: [] }, { data: [] }];
  const warnings = new Map<string, number>();
  for (const f of (fit.data ?? []) as { study_id: string; warnings: unknown; rating: string }[]) {
    const n = (Array.isArray(f.warnings) ? f.warnings.length : 0) + (f.rating === "needs_review" ? 1 : 0);
    if (n) warnings.set(f.study_id, (warnings.get(f.study_id) ?? 0) + n);
  }
  const latest = new Map<string, { status: string; version: number; created_at: string }>();
  for (const r of (reqs.data ?? []) as { study_id: string; status: string; version: number; created_at: string }[]) if (!latest.has(r.study_id)) latest.set(r.study_id, r);

  const needsReview = studies.filter((s) => s.status === "submitted");
  const shown = filter === "review" ? needsReview : studies;
  const tenantName = (s: Row) => (Array.isArray(s.tenants) ? s.tenants[0]?.name : s.tenants?.name) ?? "—";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Studies</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>{studies.length} across all workspaces · {needsReview.length} waiting for review</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/admin/studies" style={{ fontSize: 13, fontWeight: filter === "review" ? 400 : 700, color: "#111827" }}>All</Link>
          <Link href="/admin/studies?filter=review" style={{ fontSize: 13, fontWeight: filter === "review" ? 700 : 400, color: "#111827" }}>Needs review ({needsReview.length})</Link>
        </div>
      </div>

      <NotifySettings initialAddress={notify.address ?? ""} source={notify.source} />

      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>
            <th style={th}>Workspace</th><th style={th}>Study</th><th style={th}>Version</th><th style={th}>Status</th>
            <th style={th}>Request</th><th style={th}>Warnings</th><th style={th}>Updated</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td style={td} colSpan={7}>Nothing here yet.</td></tr>}
            {shown.map((s) => {
              const r = latest.get(s.id);
              return (
                <tr key={s.id}>
                  <td style={td}>{tenantName(s)}</td>
                  <td style={td}><Link href={`/admin/studies/${s.id}`} style={{ fontWeight: 600, color: "#111827" }}>{s.name}</Link><div style={{ color: "#6b7280", fontSize: 11.5 }}>{s.ref ?? ""}</div></td>
                  <td style={td}>{s.current_version > 0 ? `v${s.current_version}` : "—"}</td>
                  <td style={td}>{STUDY_STATUS_LABEL[s.status] ?? s.status}</td>
                  <td style={td}>{r ? `${r.status} (v${r.version}, ${new Date(r.created_at).toLocaleDateString("en-GB")})` : "—"}</td>
                  <td style={td}>{warnings.get(s.id) ?? 0}</td>
                  <td style={td}>{new Date(s.updated_at).toLocaleDateString("en-GB")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
