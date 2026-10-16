import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { paginate } from "@/lib/paginate";
import type { FenceProject } from "@/lib/types";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const STATUS_TONE: Record<FenceProject["status"], "green" | "amber" | "blue" | "red"> = {
  draft: "amber",
  quoted: "blue",
  won: "green",
  lost: "red",
};

export default async function FenceProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireWorkcenterView("fence_projects");
  await requireFeature("fence_projects");
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
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

  const needle = (q ?? "").trim().toLowerCase();
  const filtered = projects.filter((p) => !needle || `${p.ref ?? ""} ${p.name} ${p.account_id ? (accountNames[p.account_id] ?? "") : ""}`.toLowerCase().includes(needle));
  const pageRows = paginate(filtered, page);

  const columns: ListColumn<FenceProject>[] = [
    { id: "ref", label: "ID", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (p) => p.ref ?? "—" },
    {
      id: "name", label: "Name", card: "title",
      render: (p) => <Link href={ROUTES.fenceProject(p.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{p.name}</Link>,
    },
    { id: "account", label: "Account", cellStyle: { color: c.muted, fontSize: 13 }, render: (p) => (p.account_id ? (accountNames[p.account_id] ?? "—") : "—") },
    { id: "layout", label: "Layout", cellStyle: { color: c.muted, fontSize: 13 }, render: (p) => (p.layout === "closed_perimeter" ? "Closed perimeter" : "Open run") },
    { id: "length", label: "Length", cellStyle: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }, render: (p) => `${p.total_length_m} m` },
    { id: "status", label: "Status", render: (p) => <StatusPill label={p.status[0].toUpperCase() + p.status.slice(1)} tone={STATUS_TONE[p.status]} /> },
  ];

  return (
    <ObjectListPage
      title="Fence Projects"
      subtitle={`${projects.length} total`}
      newLabel="Fence Project"
      newHref={ROUTES.fenceProjectNew}
      search={{ value: q, placeholder: "Search by ID, name or account…" }}
      columns={columns}
      rows={pageRows}
      rowKey={(p) => p.id}
      rowHref={(p) => ROUTES.fenceProject(p.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.fenceProjects}
      linkParams={{ q }}
      filtered={!!needle}
      empty={{
        title: "No fence projects yet",
        text: "Configure a fence in the Fence Design Studio, then quote it.",
        filteredTitle: `No fence projects match "${q}".`,
      }}
    />
  );
}
