import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { isMissingSchema, loadMasters, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { parseMasterGrid, MASTER_IMPORT_LIMITS } from "@/lib/contractProjects/masters";
import { readMasterFile } from "@/lib/contractProjects/mastersFile";
import { MASTER_KIND_LABEL, isMasterKind } from "@/lib/contractProjects/types";

// POST /api/contract-projects/masters/import   multipart: kind, file (.csv or .xlsx, up to 5 MB, 20,000 rows), preview=1 (optional)
//   Reads a code list: a header row with Code and Name (and optionally Parent; for resource levels also Link to inventory, Budget
//   validation, Revenue). New codes are added; a code that is already there gets the file's name, parent and flags (source `file`) and
//   keeps its active / inactive state. Rows with no code or name, a repeated code, a parent loop or a parent that is its own child are
//   refused and listed; a parent that is not in the file or the list is dropped with a note. `preview=1` writes nothing.
//   -> { added, updated, refused, problems: [{ row, message }], warnings: [{ row, message }], preview }   Admin only.

export async function POST(request: NextRequest) {
  const gate = await openProjectRequest({ admin: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId } = gate.req;
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Send the file as a form upload" }, { status: 400 }); }
  const kind = form.get("kind");
  if (!isMasterKind(kind)) return NextResponse.json({ error: "Choose which list the file is for" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  if (file.size > MASTER_IMPORT_LIMITS.maxBytes) return NextResponse.json({ error: "That file is larger than 5 MB" }, { status: 413 });

  const read = await readMasterFile(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 422 });

  const existing = await loadMasters(admin, tenantId, kind);
  const parsed = parseMasterGrid(read.grid, kind, new Set(existing.map((m) => m.code)));
  const have = new Map(existing.map((m) => [m.code.toLowerCase(), m]));
  const toAdd = parsed.rows.filter((r) => !have.has(r.code.toLowerCase()));
  const toUpdate = parsed.rows.filter((r) => have.has(r.code.toLowerCase()));
  const summary = { added: toAdd.length, updated: toUpdate.length, refused: parsed.problems.length, problems: parsed.problems.slice(0, 50), warnings: parsed.warnings.slice(0, 50) };
  if (form.get("preview") === "1") return NextResponse.json({ ...summary, preview: true });
  if (parsed.rows.length === 0) return NextResponse.json({ ...summary, preview: false, error: parsed.problems[0]?.message ?? "Nothing to import" }, { status: 422 });

  const now = new Date().toISOString();
  for (let i = 0; i < toAdd.length; i += 500) {
    const { error } = await admin.from("erp_masters").insert(toAdd.slice(i, i + 500).map((r) => ({
      tenant_id: tenantId, kind, code: r.code, name: r.name, parent_code: r.parent_code, flags: r.flags, source: "file", active: true,
    })));
    if (error) return isMissingSchema(error) ? NextResponse.json({ ...needsUpdate().extra, error: needsUpdate().error }, { status: 503 }) : NextResponse.json({ error: error.message, ...summary }, { status: 500 });
  }
  for (const r of toUpdate) {
    const was = have.get(r.code.toLowerCase())!;
    await admin.from("erp_masters").update({ name: r.name, parent_code: r.parent_code, flags: kind === "resource" ? { ...was.flags, ...r.flags } : was.flags, source: "file", updated_at: now })
      .eq("id", was.id).eq("tenant_id", tenantId);
  }
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: tenantId, objectLabel: MASTER_KIND_LABEL[kind], action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: `${MASTER_KIND_LABEL[kind]} imported from ${file.name.slice(0, 80)}`, from: null, to: `${toAdd.length} added, ${toUpdate.length} updated, ${parsed.problems.length} refused` }],
  });
  return NextResponse.json({ ...summary, preview: false });
}
