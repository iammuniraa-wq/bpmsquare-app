import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { actionsEnabled } from "@/lib/actions/registry";
import { issueOnceConsent, verifyConsent } from "@/lib/assistant/consentToken";
import { isUuid } from "@/lib/assistant/objects";
import { isSession, logCheckSaved, resolveCheckSession } from "@/lib/suppliers/check/access";
import { PENDING_MESSAGE, buildCheck, checkGate, persistCheck, readChecks, webOn } from "@/lib/suppliers/check/service";
import { SUPPLIER_CHECK_SEARCHES } from "@/lib/suppliers/check/research";
import { loadSupplier } from "@/lib/suppliers/check/load";
import { consentQueryFor, issueSaveToken } from "@/lib/suppliers/check/token";

// The supplier check is INTERNAL: the rating and the findings steer who is asked and who is awarded, so they are deliberately not part
// of the v1 API, the MCP server or any export. No route here takes a tenant id; the supplier id is verified against the session's
// workspace before anything is read, computed or written.

// A check with web research runs two research parts side by side and may take up to about four minutes.
export const maxDuration = 300;

// GET /api/suppliers/[id]/check -- the newest saved check, the recent history, whether this person may run one, and (when web research
// is switched on) a signed one-use consent for exactly this supplier that the "Research on the web?" question sends back on Yes.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await resolveCheckSession();
  if (!isSession(s)) return s;
  const { id } = await params;
  const gate = checkGate(s, "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supplier = await loadSupplier(s.admin, s.tenantId, id);
  if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const read = await readChecks(s, id, supplier.name);
  const canRun = checkGate(s, "run").ok;
  const web = canRun && webOn(s)
    ? { available: true as const, searches: SUPPLIER_CHECK_SEARCHES, consent: { id: randomUUID() } }
    : { available: false as const, searches: SUPPLIER_CHECK_SEARCHES, consent: null };
  return NextResponse.json({
    supplier: { id: supplier.id, name: supplier.name },
    latest: read.latest, history: read.history, pending: read.pending, pendingMessage: read.pending ? PENDING_MESSAGE : null,
    canRun,
    web: web.consent ? { ...web, consent: { id: web.consent.id, token: issueOnceConsent({ tenantId: s.tenantId, userId: s.userId, query: consentQueryFor(id), id: web.consent.id }) } } : web,
  });
}

// POST /api/suppliers/[id]/check { web?, consent_token?, save? } -- run a check. The records-only check needs no consent. Web research
// runs only with the signed consent GET issued for this supplier, spent once. `save` defaults to true (the person pressed Run check on
// the supplier's own screen); the dock sends save:false, shows the result, and saves through /check/save when the person confirms.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await resolveCheckSession();
  if (!isSession(s)) return s;
  const { id } = await params;
  const gate = checkGate(s, "run");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { web?: unknown; consent_token?: unknown; save?: unknown } | null;
  let web: { consentId: string } | null = null;
  if (body?.web === true) {
    if (!webOn(s)) return NextResponse.json({ error: "Web research is not switched on for this workspace.", code: "web_off" }, { status: 403 });
    const v = verifyConsent(body.consent_token, { tenantId: s.tenantId, userId: s.userId, query: consentQueryFor(id) });
    if (!v.ok) return NextResponse.json({ error: "Nobody has said yes to web research for this supplier yet.", code: "needs_consent" }, { status: 403 });
    web = { consentId: v.id };
  }

  const built = await buildCheck(s, id, { web });
  if (!built.ok) return NextResponse.json({ error: built.error, code: built.code }, { status: built.status });

  if (body?.save === false) {
    const canSave = actionsEnabled(s.features);
    return NextResponse.json({ result: built.result, notice: built.notice, saved: false, saveToken: canSave ? issueSaveToken({ tenantId: s.tenantId, userId: s.userId, result: built.result }) : null });
  }
  const saved = await persistCheck(s, built.result);
  if (saved.ok) await logCheckSaved(s, built.result);
  return NextResponse.json({
    result: built.result, notice: built.notice, saved: saved.ok, pending: !saved.ok && saved.pending,
    ...(!saved.ok ? { saveError: saved.error } : {}),
  });
}
