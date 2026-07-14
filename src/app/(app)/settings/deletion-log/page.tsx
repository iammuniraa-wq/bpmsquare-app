import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { isPlatformAdmin } from "@/lib/tenant";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import DeletionLogClient from "./DeletionLogClient";

export default async function DeletionLogPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const [{ data }, platformAdmin] = await Promise.all([
    createAdminSupabase().from("tenants").select("config").eq("id", tenantId!).single(),
    isPlatformAdmin(),
  ]);

  const cfg = (data?.config ?? {}) as Record<string, unknown>;
  const logs = {
    deleted_quotes:      Array.isArray(cfg.deleted_quotes)      ? cfg.deleted_quotes      : [],
    deleted_cases:       Array.isArray(cfg.deleted_cases)       ? cfg.deleted_cases       : [],
    deleted_work_orders: Array.isArray(cfg.deleted_work_orders) ? cfg.deleted_work_orders : [],
    deleted_accounts:    Array.isArray(cfg.deleted_accounts)    ? cfg.deleted_accounts    : [],
  };

  return (
    <>
      <PageHeader
        title="Deleted records"
        subtitle="Audit log of permanently deleted objects"
      />
      <DeletionLogClient logs={logs} isPlatformAdmin={platformAdmin} />
    </>
  );
}
