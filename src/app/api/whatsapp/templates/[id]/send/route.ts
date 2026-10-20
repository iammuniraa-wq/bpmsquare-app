import { NextResponse, type NextRequest } from "next/server";
import { isUuid, moduleAccess, moduleErrorResponse } from "@/lib/marketing/moduleAccess";
import { WHATSAPP_SPEC } from "@/lib/marketing/whatsapp/server";
import { sendWhatsAppTemplate } from "@/lib/marketing/whatsapp/send";
import { REASONS } from "@/lib/marketing/whatsapp/reasons";

// POST /api/whatsapp/templates/[id]/send { contact_id }  -- a person sends one template to one contact.
// The very function a journey uses: consent is asked first, an unapproved template is refused, a demo workspace
// never reaches a real number. Neither id is trusted: the template and the contact are loaded by id AND the
// caller's tenant inside sendWhatsAppTemplate().

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "edit");
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { contact_id?: unknown } | null;
    if (!isUuid(id) || !isUuid(body?.contact_id)) return NextResponse.json({ error: "Choose a template and a person." }, { status: 422 });

    const { data: contact } = await ctx.admin.from("contacts").select("id, name, account_id").eq("id", body.contact_id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Person not found." }, { status: 404 });
    const { data: account } = await ctx.admin.from("accounts").select("name").eq("id", (contact as { account_id: string }).account_id).eq("tenant_id", ctx.tenantId).maybeSingle();

    const r = await sendWhatsAppTemplate(ctx.admin, {
      tenantId: ctx.tenantId, contactId: body.contact_id, templateId: id, origin: "rep", actorId: ctx.userId,
      values: { contact_name: (contact as { name: string }).name.split(" ")[0], account_name: (account as { name?: string } | null)?.name ?? null },
    });
    const sentence = r.status === "sent" ? "Sent." : (REASONS[r.reason] ?? r.reason);
    return NextResponse.json({ status: r.status, reason: r.reason, message: sentence, id: r.messageId }, { status: r.status === "failed" ? 502 : 200 });
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}
