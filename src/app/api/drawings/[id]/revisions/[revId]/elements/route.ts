import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { failResponse } from "@/lib/drawings/http";
import { openRevision } from "@/lib/drawings/open";
import { loadElements, loadRevisions, loadType } from "@/lib/drawings/server";
import { replaceElements } from "@/lib/drawings/writes";
import { MAX_SCHEDULE_BYTES, sniffFile } from "@/lib/drawings/files";
import { readerFor, unitsToConfirm, UNIT_CHOICES, type ScheduleMap } from "@/lib/drawings/schedule";

// GET  the elements this revision declares (empty when none were loaded).
// POST multipart: file (an .xlsx or .csv schedule), mode = "preview" | "load", map? (JSON {columns, sheet, units, density_t_m3}),
//      confirm_units? ("true"), save_map? ("true", admins only: keeps the map on the drawing type for the next schedule).
//      Route B of the design: a person drops the file, nothing is fetched from anywhere. "preview" reads it and answers what it WOULD load
//      (headers, the map, the units found, ten rows, warnings) and changes nothing; "load" replaces the elements of this DRAFT revision.
//      A quantity column whose unit the file does not state must be confirmed first. The same file cannot be loaded on two revisions of a drawing.

type Ctx = { params: Promise<{ id: string; revId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId);
  if (!opened.ok) return failResponse(opened);
  const elements = await loadElements(opened.req.admin, opened.req.tenantId, revId);
  return NextResponse.json({ elements });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId, { write: true });
  if (!opened.ok) return failResponse(opened);
  const { admin, tenantId, role } = opened.req;
  if (opened.revision.status !== "draft") return NextResponse.json({ error: "Only a draft revision can take elements" }, { status: 409 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return NextResponse.json({ error: "Attach a schedule file" }, { status: 400 });
  if (file.size > MAX_SCHEDULE_BYTES) return NextResponse.json({ error: "A schedule can be up to 4 MB. Split it by building" }, { status: 422 });
  const reader = readerFor(file.name);
  if (!reader) return NextResponse.json({ error: "A schedule is an Excel (.xlsx) or CSV file" }, { status: 422 });
  if (!reader.available) return NextResponse.json({ error: reader.unavailableReason ?? "That kind of file cannot be read yet" }, { status: 422 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniff = sniffFile(file.name, bytes.subarray(0, 4096));
  if (!sniff.ok) return NextResponse.json({ error: sniff.error }, { status: 422 });

  const type = await loadType(admin, tenantId, opened.drawing.type_id);
  let posted: Partial<ScheduleMap> = {};
  const rawMap = form.get("map");
  if (typeof rawMap === "string" && rawMap.trim()) {
    try { const p = JSON.parse(rawMap); if (p && typeof p === "object") posted = p as Partial<ScheduleMap>; } catch { return NextResponse.json({ error: "The column map is not valid" }, { status: 400 }); }
  }
  const saved = (type?.schedule_map ?? {}) as Partial<ScheduleMap>;
  const map: ScheduleMap = {
    columns: { ...(saved.columns ?? {}), ...(posted.columns ?? {}) },
    sheet: posted.sheet ?? saved.sheet,
    units: { ...(saved.units ?? {}), ...(posted.units ?? {}) },
    density_t_m3: Number(posted.density_t_m3 ?? saved.density_t_m3) || undefined,
  };

  const result = await reader.read({ name: file.name, bytes, map });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  const confirm = unitsToConfirm(result);
  const mode = form.get("mode") === "load" ? "load" : "preview";
  const sha = createHash("sha256").update(bytes).digest("hex");

  if (mode === "preview") {
    return NextResponse.json({
      mode, headers: result.headers, map: result.map, sheet: result.sheet, sheets: result.sheets, units: result.units, unitChoices: UNIT_CHOICES,
      confirmUnits: confirm, count: result.elements.length, skipped: result.skipped, warnings: result.warnings, sample: result.elements.slice(0, 10), sha256: sha,
    });
  }

  if (confirm.length > 0 && form.get("confirm_units") !== "true") {
    return NextResponse.json({ error: `The file does not state the unit of ${confirm.join(", ")}. Confirm the units and load again`, confirmUnits: confirm }, { status: 422 });
  }
  const { rows } = await loadRevisions(admin, tenantId, id);
  const twin = rows.find((r) => r.id !== revId && r.change_summary?.elements?.sha256 === sha);
  if (twin) return NextResponse.json({ error: `This schedule was already loaded on revision ${twin.rev_label}` }, { status: 409 });

  const done = await replaceElements(opened.req, opened.drawing, opened.revision, result.elements, { source: reader.id, file_name: file.name, sha256: sha });
  if (!done.ok) return failResponse(done);

  // Saved once per type, by an admin: the next schedule of this type needs no mapping.
  if (form.get("save_map") === "true" && role === "admin" && type) {
    await admin.from("drawing_types").update({ schedule_map: { columns: result.map, sheet: result.sheet, units: Object.fromEntries(Object.entries(result.units).map(([q, u]) => [q, u.unit])), density_t_m3: map.density_t_m3 ?? null }, updated_at: new Date().toISOString() })
      .eq("id", type.id).eq("tenant_id", tenantId);
  }
  return NextResponse.json({ mode, count: done.count, revision: done.revision, warnings: result.warnings, skipped: result.skipped }, { status: 201 });
}
