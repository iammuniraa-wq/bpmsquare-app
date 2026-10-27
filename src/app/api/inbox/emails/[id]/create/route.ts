import { NextResponse, type NextRequest } from "next/server";
import { canCreateWorkcenter } from "@/lib/permissions";
import { inboxAccess, errorResponse, loadEmailForViewer, type InboxCtx } from "@/lib/inbox/server";
import { convertEmail, matchSender, type CreateInput } from "@/lib/inbox/convert";
import { createAccountFromSender, defaultCreators } from "@/lib/inbox/creators";
import { LINK_ACCESS, linkHref } from "@/lib/inbox/links";
import { suggestedName, summarise } from "@/lib/inbox/rules";
import { CREATE_TO_OBJECT, CREATE_TYPES, type CreateType } from "@/lib/inbox/types";

export const maxDuration = 60;

// POST /api/inbox/emails/[id]/create
//   { type: quote | project | case | lead | deal,   (deal: only with the tender edition, flag gcc_tender)
//     account_id?, contact_id?, new_account?: { name, contact_name? },
//     title?, case_type?, complaint? }
// Makes the record through its own create route, copies the email's files onto it, stores the sender and a short
// summary on it, links the message to it and marks the message handled. Estimates are started in the estimate workspace
// (the browser opens it); they are linked when the estimate is saved.
//
// Every id in the body (account, contact) is checked against THIS workspace before it is used.

type Body = {
  type?: unknown; account_id?: unknown; contact_id?: unknown; new_account?: { name?: unknown; contact_name?: unknown } | null;
  title?: unknown; case_type?: unknown; complaint?: unknown;
};

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function ownedAccount(ctx: InboxCtx, id: string): Promise<boolean> {
  const { data } = await ctx.admin.from("accounts").select("id").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  return !!data;
}
async function ownedContact(ctx: InboxCtx, id: string, accountId: string | null): Promise<boolean> {
  const q = ctx.admin.from("contacts").select("id").eq("id", id).eq("tenant_id", ctx.tenantId);
  const { data } = await (accountId ? q.eq("account_id", accountId) : q).maybeSingle();
  return !!data;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await inboxAccess(true);
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

    const type = body.type as CreateType;
    if (!CREATE_TYPES.includes(type) || type === "estimate") {
      return NextResponse.json({ error: "type must be quote, project, case, lead or deal." }, { status: 422 });
    }
    const access = LINK_ACCESS[CREATE_TO_OBJECT[type]];
    if (!ctx.features[access.feature as keyof typeof ctx.features] || (access.also && !ctx.features[access.also as keyof typeof ctx.features])) return NextResponse.json({ error: "That isn't part of your workspace." }, { status: 403 });
    if (!canCreateWorkcenter(ctx.perms, access.workcenter)) return NextResponse.json({ error: "Your role cannot create these." }, { status: 403 });

    const found = await loadEmailForViewer(ctx, id);
    if (!found) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    const { email, channel } = found;

    // The account: the one the person chose, else a new one from the sender, else the sender's own.
    let accountId = str(body.account_id, 64);
    let contactId = str(body.contact_id, 64);
    if (accountId && !(await ownedAccount(ctx, accountId))) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    if (contactId && !(await ownedContact(ctx, contactId, accountId))) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

    if (!accountId && body.new_account) {
      const name = str(body.new_account.name, 200);
      if (!name) return NextResponse.json({ error: "Give the new account a name." }, { status: 422 });
      if (!ctx.features.accounts || !canCreateWorkcenter(ctx.perms, "accounts")) return NextResponse.json({ error: "Your role cannot create accounts." }, { status: 403 });
      const made = await createAccountFromSender({ accountName: name, email: email.from_address, contactName: str(body.new_account.contact_name, 200) ?? (ctx.features.contacts ? suggestedName({ name: email.from_name, address: email.from_address }) : null) });
      if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status });
      accountId = made.accountId;
      contactId = made.contactId;
    }
    if (!accountId) {
      const m = await matchSender(ctx.admin, ctx.tenantId, email.from_address);
      if (m?.accountId) { accountId = m.accountId; contactId = contactId ?? m.contactId; }
    }
    if (type !== "project" && !accountId) return NextResponse.json({ error: "Choose the account this is for, or create one from the sender." }, { status: 422 });

    const subject = email.subject.trim() || "Customer enquiry";
    const input: CreateInput = {
      type, accountId, contactId, emailId: email.id,
      title: str(body.title, 200) ?? subject.slice(0, 200),
      caseType: body.case_type === "direct" || body.case_type === "amc" ? body.case_type : "adhoc",
      complaint: str(body.complaint, 2000) ?? (summarise(email.body_text) || subject),
    };

    const r = await convertEmail(ctx.admin, {
      tenantId: ctx.tenantId, email, channel, input, actor: { id: ctx.userId, email: ctx.email }, creators: defaultCreators,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({
      ok: true, object_type: r.objectType, object_id: r.objectId, label: r.label, copied: r.copied, total_files: r.total,
      href: linkHref(r.objectType, r.objectId, ctx.features as Record<string, boolean>),
    }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
