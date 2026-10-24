// Loading the attachments a person ticked for "Read the email". The ids come from the browser, so nothing about them is
// trusted: each one is looked up WITH the session's tenant AND the opened message's id, the message itself has to be one
// the person may see (their channel), and the storage path has to sit under `${tenantId}/`. A path is never taken from
// the request. One bad file is reported by name and the rest still read.

import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanName, convertFile, type ReadFile } from "./convert";
import { classifyFile, INTAKE_LIMITS, skipReason } from "./kinds";

export type SkippedFile = { id: string; name: string; reason: string };

/** What the response tells the page about each file: read (with the page link's attachment id) or skipped and why. */
export type FileReport = { id: string; name: string; status: "read" | "skipped"; kind: ReadFile["kind"] | "dxf" | null; pages: number | null; note: string | null };

export type LoadDeps = {
  admin: SupabaseClient;
  /** From requireTenantUser(), never from the request. */
  tenantId: string;
  /** True when the signed-in person may see this message (loadEmailForViewer). */
  canSeeEmail: (emailId: string) => Promise<boolean>;
  /** The file's bytes from the private bucket, or null. */
  download: (path: string) => Promise<Uint8Array | null>;
};

export type LoadedFiles = { files: ReadFile[]; skipped: SkippedFile[] };

type Row = { id: string; email_id: string; file_name: string; mime_type: string | null; ext: string | null; size_bytes: number | string | null; storage_path: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

function uniqueName(raw: string, used: Set<string>): string {
  const base = cleanName(raw);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const dot = base.lastIndexOf(".");
    name = dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
  }
  used.add(name.toLowerCase());
  return name;
}

export async function loadIntakeFiles(deps: LoadDeps, args: { emailId: unknown; attachmentIds: unknown }): Promise<LoadedFiles> {
  const none: LoadedFiles = { files: [], skipped: [] };
  if (!isId(args.emailId) || !Array.isArray(args.attachmentIds)) return none;
  const wanted = [...new Set(args.attachmentIds.filter(isId))];
  if (wanted.length === 0) return none;

  // Not a message this person may see: the ids are ignored, as if they named nothing.
  if (!(await deps.canSeeEmail(args.emailId))) return { files: [], skipped: [{ id: "", name: "Attachments", reason: "The files of that message could not be opened." }] };

  // Looked up with the tenant AND the message: another message's, or another workspace's, id finds nothing.
  const { data, error } = await deps.admin.from("inbound_email_attachments")
    .select("id, email_id, file_name, mime_type, ext, size_bytes, storage_path")
    .eq("tenant_id", deps.tenantId).eq("email_id", args.emailId).in("id", wanted);
  if (error) return none;
  const found = new Map(((data ?? []) as Row[]).filter((r) => r.email_id === args.emailId).map((r) => [r.id, r]));

  const files: ReadFile[] = [];
  const skipped: SkippedFile[] = [];
  const used = new Set<string>();
  let total = 0;
  const rows = wanted.map((id) => found.get(id)).filter((r): r is Row => !!r);

  for (const row of rows) {
    const name = uniqueName(row.file_name, used);
    const skip = (reason: string) => { skipped.push({ id: row.id, name, reason }); };
    const kind = classifyFile(row.file_name, row.mime_type, row.ext);
    const size = Number(row.size_bytes ?? 0);
    const why = skipReason(kind, size, row.ext, row.file_name);
    if (why) { skip(why); continue; }
    if (files.length >= INTAKE_LIMITS.maxFiles) { skip(`Only the first ${INTAKE_LIMITS.maxFiles} files are read.`); continue; }
    if (total + size > INTAKE_LIMITS.maxTotalBytes) { skip(`Reading this file would pass the ${INTAKE_LIMITS.maxTotalBytes / 1024 / 1024} MB limit for one reading.`); continue; }
    if (typeof row.storage_path !== "string" || !row.storage_path.startsWith(`${deps.tenantId}/`)) { skip("The file could not be opened."); continue; }
    let bytes: Uint8Array | null = null;
    try { bytes = await deps.download(row.storage_path); } catch { bytes = null; }
    if (!bytes) { skip("The file could not be opened."); continue; }
    if (total + bytes.byteLength > INTAKE_LIMITS.maxTotalBytes) { skip(`Reading this file would pass the ${INTAKE_LIMITS.maxTotalBytes / 1024 / 1024} MB limit for one reading.`); continue; }
    const c = await convertFile(name, kind, bytes);
    if (!c.ok) { skip(c.note); continue; }
    total += bytes.byteLength;
    files.push({ ...c.file, id: row.id, name });
  }
  return { files, skipped };
}

/** The per-file report the page shows: what was read (with its page count) and what was not, by name. */
export function fileReports(loaded: LoadedFiles): FileReport[] {
  return [
    ...loaded.files.map((f): FileReport => ({ id: f.id, name: f.name, status: "read", kind: f.kind, pages: f.pages, note: null })),
    ...loaded.skipped.filter((s) => s.id).map((s): FileReport => ({ id: s.id, name: s.name, status: "skipped", kind: null, pages: null, note: s.reason })),
  ];
}
