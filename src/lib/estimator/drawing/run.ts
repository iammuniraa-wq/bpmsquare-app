import "server-only";
import type { InboxCtx } from "@/lib/inbox/server";
import { parseDxf } from "./dxf";
import { buildPayload, type DrawingPayload } from "./payload";
import { loadDxfAttachment } from "./server";

export type MeasureResult = { ok: true; payload: DrawingPayload } | { ok: false; status: number; error: string };

/** Load, parse and measure one DXF attachment. `factor` (metres per unit) replaces the drawing's own unit when the person chose one. */
export async function measureAttachment(
  ctx: Pick<InboxCtx, "admin" | "tenantId" | "viewer">,
  args: { emailId: unknown; attachmentId: unknown; factor?: number | null }
): Promise<MeasureResult> {
  const loaded = await loadDxfAttachment(ctx, args.emailId, args.attachmentId);
  if (!loaded.ok) return loaded;
  const parsed = parseDxf(loaded.file.bytes);
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };
  return { ok: true, payload: buildPayload(loaded.file.name, parsed.model, args.factor === undefined ? {} : { factor: args.factor }) };
}
