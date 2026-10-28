import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

const STATUSES = ["active", "on_leave", "inactive"];
const REASONS = ["vacation", "sick", "training", "other"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type LeaveIn = { id?: string; from_date?: string; to_date?: string; reason?: string; notes?: string | null };

// Edit profile screen: personal info, status, skills, certifications and the leave schedule are saved together.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    patch.name = name;
  }
  for (const key of ["phone", "email", "skills", "base_location"] as const) {
    if (key in body) patch[key] = String(body[key] ?? "").trim() || null;
  }
  if ("max_visits_per_day" in body) {
    const n = Number(body.max_visits_per_day);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return NextResponse.json({ error: "Max visits per day must be between 1 and 10" }, { status: 422 });
    }
    patch.max_visits_per_day = n;
  }
  if ("status" in body) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    patch.status = body.status;
  }
  if ("certifications" in body || "cert_expiry" in body) {
    const certs: Array<{ name?: string; expiry?: string }> = Array.isArray(body.certifications) ? body.certifications : [];
    const names: string[] = [];
    const expiry: Record<string, string> = {};
    for (const c of certs) {
      const name = String(c?.name ?? "").trim();
      if (!name) continue;
      names.push(name);
      if (c.expiry) {
        if (!DATE.test(c.expiry)) return NextResponse.json({ error: "Invalid certification expiry date" }, { status: 422 });
        expiry[name] = c.expiry;
      }
    }
    patch.certifications = names;
    patch.cert_expiry = expiry;
  }

  let leaves: LeaveIn[] | null = null;
  if ("leaves" in body) {
    if (!Array.isArray(body.leaves)) return NextResponse.json({ error: "Invalid leave schedule" }, { status: 422 });
    leaves = body.leaves as LeaveIn[];
    for (const l of leaves) {
      if (!l.from_date || !l.to_date || !DATE.test(l.from_date) || !DATE.test(l.to_date)) {
        return NextResponse.json({ error: "Each leave entry needs a From and a To date" }, { status: 422 });
      }
      if (l.to_date < l.from_date) {
        return NextResponse.json({ error: "A leave entry ends before it starts" }, { status: 422 });
      }
      if (!l.reason || !REASONS.includes(l.reason)) {
        return NextResponse.json({ error: "Invalid leave reason" }, { status: 422 });
      }
    }
  }

  const { data: before } = await supabase
    .from("technicians")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let data: Record<string, unknown> = before as Record<string, unknown>;
  if (Object.keys(patch).length > 0) {
    const res = await supabase
      .from("technicians")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    data = res.data as Record<string, unknown>;
  }

  const changes = diffForLog("technicians", before as Record<string, unknown>, patch);

  if (leaves) {
    const { data: existing, error: exErr } = await supabase
      .from("technician_leaves")
      .select("id, from_date, to_date, reason, notes")
      .eq("technician_id", id).eq("tenant_id", tenantId);
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
    const existingRows = (existing ?? []) as Array<{ id: string; from_date: string; to_date: string; reason: string; notes: string | null }>;
    const existingIds = new Set(existingRows.map((r) => r.id));
    const sig = (r: { from_date?: string; to_date?: string; reason?: string; notes?: string | null }) =>
      `${r.from_date}|${r.to_date}|${r.reason}|${(r.notes ?? "").toString().trim()}`;
    const beforeSig = existingRows.map(sig).sort().join(";");
    const afterSig = leaves.map(sig).sort().join(";");
    const keep = new Set<string>();
    for (const l of leaves) {
      const row = {
        from_date: l.from_date, to_date: l.to_date, reason: l.reason,
        notes: (l.notes ?? "").toString().trim() || null,
      };
      if (l.id && existingIds.has(l.id)) {
        keep.add(l.id);
        const { error } = await supabase.from("technician_leaves").update(row)
          .eq("id", l.id).eq("tenant_id", tenantId).eq("technician_id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { error } = await supabase.from("technician_leaves")
          .insert({ ...row, tenant_id: tenantId, technician_id: id });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    const drop = [...existingIds].filter((x) => !keep.has(x));
    if (drop.length > 0) {
      const { error } = await supabase.from("technician_leaves").delete()
        .in("id", drop).eq("tenant_id", tenantId).eq("technician_id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (beforeSig !== afterSig) changes.push({ field: "leave_schedule", from: existingIds.size, to: leaves.length });
  }

  if (changes.length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "technicians", objectId: id, objectLabel: (data.name as string) ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  // Returned so the form can swap its placeholder ids for the stored ones; a second save must update, not insert again.
  let savedLeaves: unknown[] | undefined;
  if (leaves) {
    const { data: rows } = await supabase
      .from("technician_leaves")
      .select("id, from_date, to_date, reason, notes")
      .eq("technician_id", id).eq("tenant_id", tenantId)
      .order("from_date", { ascending: true });
    savedLeaves = rows ?? [];
  }

  return NextResponse.json({ id, name: data.name, ...(savedLeaves ? { leaves: savedLeaves } : {}) });
}
