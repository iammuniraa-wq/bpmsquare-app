import Link from "next/link";
import { notFound } from "next/navigation";
import { isPlatformAdmin, createAdminSupabase } from "@/lib/supabase-server";
import { getCapabilityCatalog, catalogById } from "@/lib/capability/catalog";
import { loadStudyForPlatformAdmin } from "@/lib/studio/server";
import { STUDY_STATUS_LABEL } from "@/lib/studio/types";
import ReviewClient, { type ReviewRequest } from "./ReviewClient";

export default async function AdminStudyPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return null;
  const { id } = await params;
  const loaded = await loadStudyForPlatformAdmin(id);
  if (!loaded) notFound();
  const { bundle, tenantName, isDemo, tenantId } = loaded;
  const { study } = bundle;

  const byId = catalogById(getCapabilityCatalog());
  const labels: Record<string, string> = {};
  for (const f of bundle.fit) for (const c of f.capability_ids) labels[c] = byId.get(c)?.label ?? c;

  // Contact details are on the request rows (encrypted); decrypted here, server side, for the reviewer only.
  const { decrypt } = await import("@/lib/encryption");
  const { data: reqs } = await createAdminSupabase().from("process_study_requests")
    .select("id, version, status, contact_name, contact_email, email_status, email_note, notes, created_at")
    .eq("study_id", id).eq("tenant_id", tenantId).order("created_at", { ascending: false });
  const requests: ReviewRequest[] = ((reqs ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string, version: r.version as number, status: r.status as string, contact_name: (r.contact_name as string | null) ?? null,
    contact_email: decrypt((r.contact_email as string | null) ?? null), email_status: r.email_status as string,
    email_note: (r.email_note as string | null) ?? null, notes: (r.notes as string | null) ?? null, created_at: r.created_at as string,
  }));

  return (
    <div>
      <p style={{ margin: "0 0 8px" }}><Link href="/admin/studies" style={{ fontSize: 13 }}>← All studies</Link></p>
      <div style={{ background: "#fdf0dc", color: "#633806", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>
        Reviewer · {tenantName}{isDemo ? " (demo workspace)" : ""}
      </div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>{study.name}</h1>
      <p style={{ margin: "4px 0 14px", fontSize: 13, color: "#6b7280" }}>
        {study.ref} · {STUDY_STATUS_LABEL[study.status]} · version {study.current_version}
        {study.reviewed_at ? ` · reviewed ${new Date(study.reviewed_at).toLocaleDateString("en-GB")}` : ""}
      </p>
      {study.summary && <p style={{ fontSize: 13.5, maxWidth: 760 }}>{study.summary}</p>}
      <ReviewClient studyId={study.id} bundle={bundle} labels={labels} requests={requests} reviewed={!!study.reviewed_at} />
    </div>
  );
}
