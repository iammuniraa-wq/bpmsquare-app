import "server-only";
import { loadDrawing, loadRevision, needsUpdate, openDrawingRequest, type DrawingCtx, type Failure } from "./server";
import type { DrawingRow, RevisionRow } from "./types";

// "Open this drawing (and revision) for this caller": the gate, then the tenant-scoped load, in one call so every route starts the same way.

export async function openDrawing(id: string, opts: { write?: boolean; admin?: boolean } = {}): Promise<{ ok: true; req: DrawingCtx; drawing: DrawingRow } | ({ ok: false } & Failure)> {
  const gate = await openDrawingRequest(opts);
  if (!gate.ok) return gate;
  const found = await loadDrawing(gate.req.admin, gate.req.tenantId, id);
  if (found.kind === "pending") return { ok: false, ...needsUpdate() };
  if (found.kind !== "ok") return { ok: false, status: 404, error: "Not found" };
  return { ok: true, req: gate.req, drawing: found.drawing };
}

export async function openRevision(id: string, revId: string, opts: { write?: boolean; admin?: boolean } = {}): Promise<{ ok: true; req: DrawingCtx; drawing: DrawingRow; revision: RevisionRow } | ({ ok: false } & Failure)> {
  const opened = await openDrawing(id, opts);
  if (!opened.ok) return opened;
  const revision = await loadRevision(opened.req.admin, opened.req.tenantId, opened.drawing.id, revId);
  if (!revision) return { ok: false, status: 404, error: "Not found" };
  return { ...opened, revision };
}
