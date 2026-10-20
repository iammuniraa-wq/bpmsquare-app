import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canContact } from "@/lib/marketing/consent";
import { isSchemaPending } from "@/lib/marketing/pending";
import { newsletterFieldsForCreate } from "@/lib/newsletter/campaignFields";
import { groupSkipReasons } from "@/lib/newsletter/audienceWords";
import { explainLanguage, resolveRecipientLanguage } from "@/lib/newsletter/language";
import { renderForPerson } from "@/lib/newsletter/personPreview";
import { isUuid } from "@/lib/newsletter/requests";
import { errorResponse, loadVersion, newsletterAccess } from "@/lib/newsletter/server";

// POST /api/newsletters/preview-as { newsletter_version_id, languages, fallback_language, topic?, contact_id | account_id }
// "See it as this person": the email exactly as that person would get it from this send (their language
// through the fallback rules, the fields filled in), plus one sentence on which rule applied. Sends nothing
// and records nothing. Both ids are looked up for THIS workspace only; another workspace's id finds nobody.

type Person = { id: string; account_id: string; name: string | null; preferred_language?: string | null };

async function selectWithLanguage<T>(run: (cols: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, cols: string): Promise<T | null> {
  let r = await run(`${cols}, preferred_language`);
  if (r.error && isSchemaPending(r.error)) r = await run(cols);
  return (r.data ?? null) as T | null;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await newsletterAccess("view");
    const { tenantId, admin } = ctx;
    const db: SupabaseClient = ctx.supabase;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body." }, { status: 422 });

    const fields = await newsletterFieldsForCreate(tenantId, body);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: fields.status });
    const version = await loadVersion(admin, tenantId, fields.fields.newsletter_version_id as string);
    if (!version) return NextResponse.json({ error: "That newsletter version was not found." }, { status: 404 });

    let contact: Person | null = null;
    let account: { id: string; name: string; preferred_language?: string | null } | null = null;
    if (isUuid(body.contact_id)) {
      const rows = await selectWithLanguage<Person[]>((c) => db.from("contacts").select(c).eq("id", body.contact_id).eq("tenant_id", tenantId).limit(1), "id, account_id, name");
      contact = rows?.[0] ?? null;
      if (!contact) return NextResponse.json({ error: "That person was not found." }, { status: 404 });
      const a = await selectWithLanguage<{ id: string; name: string; preferred_language?: string | null }[]>((c) => db.from("accounts").select(c).eq("id", contact!.account_id).eq("tenant_id", tenantId).limit(1), "id, name");
      account = a?.[0] ?? null;
    } else if (isUuid(body.account_id)) {
      const a = await selectWithLanguage<{ id: string; name: string; preferred_language?: string | null }[]>((c) => db.from("accounts").select(c).eq("id", body.account_id).eq("tenant_id", tenantId).limit(1), "id, name");
      account = a?.[0] ?? null;
      if (!account) return NextResponse.json({ error: "That company was not found." }, { status: 404 });
      // Same rule as the send: the account's oldest contact stands for it.
      const rows = await selectWithLanguage<Person[]>((c) => db.from("contacts").select(c).eq("account_id", account!.id).eq("tenant_id", tenantId).order("created_at", { ascending: true }).limit(1), "id, account_id, name");
      contact = rows?.[0] ?? null;
    } else return NextResponse.json({ error: "Pick a person or a company." }, { status: 422 });

    const first = (contact?.name ?? "").trim().split(/\s+/)[0] || account?.name || "This person";
    const choice = resolveRecipientLanguage({
      contactLanguage: contact?.preferred_language, accountLanguage: account?.preferred_language, included: fields.fields.languages, fallback: fields.fields.fallback_language,
    });
    const out = renderForPerson(version, choice.lang, { account_name: account?.name ?? "", company_name: ctx.tenantName, contact_name: (contact?.name ?? "").trim().split(/\s+/)[0] ?? "" });
    if (!out) return NextResponse.json({ error: "That language is not ready in this version." }, { status: 422 });

    let note: string;
    if (!contact) note = "This company has no contact yet, so the send would skip it: consent and language belong to a person.";
    else {
      const d = await canContact(tenantId, contact.id, "email", fields.fields.topic, admin);
      note = d.ok ? `${first} would be sent this.` : `${first} would be skipped: ${groupSkipReasons({ [d.reason]: 1 })[0]?.label ?? d.reason}.`;
    }
    return NextResponse.json({
      name: contact?.name ?? account?.name ?? "", company: account?.name ?? null, lang: choice.lang, via: choice.via,
      explanation: explainLanguage({ person: first, choice, contactLanguage: contact?.preferred_language, accountLanguage: account?.preferred_language }),
      note, subject: out.subject, html: out.html,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
