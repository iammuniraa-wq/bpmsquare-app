import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import type { Employee } from "@/lib/types";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import { NewEmployeeButton, EmployeeRowActions } from "./EmployeeEditor";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SORT_EXTRACTORS: Record<string, SortExtractor<Employee>> = {
  name: (e) => `${e.first_name} ${e.last_name}`,
  code: (e) => e.employee_code,
  email: (e) => e.email,
  department: (e) => e.department,
  validity: (e) => e.valid_from,
  status: (e) => e.status,
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("employees");
  await requireFeature("business_roles");
  const { supabase, tenantId, role } = await requireTenantUser();
  const canEdit = role === "admin";
  const params = await searchParams;
  const { q } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("last_name")
    .order("first_name");
  const employees = (data ?? []) as Employee[];

  const needle = (q ?? "").trim().toLowerCase();
  const searched = needle
    ? employees.filter((e) => [e.first_name, e.last_name, e.employee_code, e.email, e.department, e.designation].some((v) => v?.toLowerCase().includes(needle)))
    : employees;
  const filtered = sortRows(applyColFilters(searched, colFilters, SORT_EXTRACTORS), sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const columns: ListColumn<Employee>[] = [
    { id: "name", label: "Name", sortKey: "name", card: "title", cellStyle: { fontWeight: 600 }, render: (e) => `${e.first_name} ${e.last_name}` },
    { id: "code", label: "Code", sortKey: "code", cellStyle: { fontFamily: "monospace", fontSize: 12, color: c.muted }, render: (e) => e.employee_code ?? "—" },
    {
      id: "email", label: "Contact", sortKey: "email", cellStyle: { color: c.muted },
      render: (e) => (e.email || e.phone ? <>{e.email ?? ""}{e.email && e.phone ? <br /> : null}{e.phone ?? ""}</> : "—"),
    },
    {
      id: "department", label: "Department · Designation", sortKey: "department", cellStyle: { color: c.muted },
      render: (e) => [e.department, e.designation].filter(Boolean).join(" · ") || "—",
    },
    {
      id: "validity", label: "Validity", sortKey: "validity", cellStyle: { color: c.muted, whiteSpace: "nowrap" },
      render: (e) => (e.valid_from || e.valid_to ? `${fmtDate(e.valid_from)} → ${fmtDate(e.valid_to)}` : "—"),
    },
    { id: "status", label: "Status", sortKey: "status", render: (e) => <StatusPill label={e.status === "active" ? "Active" : "Inactive"} tone={e.status === "active" ? "green" : "red"} /> },
    ...(canEdit ? [{
      id: "actions", label: "", width: 130, cellStyle: { textAlign: "right" as const },
      render: (e: Employee) => <EmployeeRowActions employee={e} />,
    }] : []),
  ];

  return (
    <ObjectListPage
      title="Employees"
      subtitle="Your people as master data — create them here or bulk-load from an HR export via Data Workbench, then give one a login in Settings → People."
      newAction={canEdit ? <NewEmployeeButton /> : undefined}
      search={{ value: q, placeholder: "Search name, code, email, department…", hiddenParams: cfParams }}
      columns={columns}
      rows={pageRows}
      rowKey={(e) => e.id}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.employees}
      sort={sort}
      dir={dir}
      linkParams={{ q, ...cfParams }}
      filtered={!!(needle || Object.keys(cfParams).length > 0)}
      empty={{
        title: "No employees yet",
        text: canEdit ? "Create one with + New Employee, or bulk-load an HR export via Data Workbench → Employees." : "No employees have been added yet.",
        filteredTitle: needle ? `No employees match "${q}".` : "No employees match these filters.",
      }}
    />
  );
}
