import { createAdminSupabase } from "@/lib/supabase-server";
import { controlPlanePrivateKey } from "@/lib/controlPlane/crypto";
import { listInstances } from "@/lib/controlPlane/registry";
import { buildSummary } from "@/lib/controlPlane/summary";
import { instanceCard, localCard, tenantLines } from "@/lib/controlPlane/view";
import InstancesClient from "./InstancesClient";

// Every instance (a separate database + app deployment) and every tenant on them, in one place. The app this page runs on is
// computed locally from its own database (no request to itself); the others come from their last signed pull, stored in the
// registry (migration 0247). The admin layout already gates on isPlatformAdmin().

export const dynamic = "force-dynamic";

export default async function InstancesPage() {
  const admin = createAdminSupabase();
  const [local, registry] = await Promise.all([buildSummary(admin), listInstances(admin)]);
  return (
    <InstancesClient
      cards={[localCard(local), ...registry.rows.map(instanceCard)]}
      tenants={tenantLines(local, registry.rows)}
      registryPending={registry.pending}
      signingConfigured={controlPlanePrivateKey() !== null}
    />
  );
}
