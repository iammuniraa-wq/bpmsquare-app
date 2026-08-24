import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { getEffectiveFieldConfig, getSalesConfig, type SalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import type { ObjectSpec } from "@/lib/import/types";
import { extractRowsFromDocument, ExtractionError } from "@/lib/import/extract";

/**
 * Nova pillar 2 — AI record creation. Paste anything (a WhatsApp message,
 * an email, a signature block) and get a DRAFTED record: the same
 * tool-forced extraction engine Data Workbench uses, pointed at a single
 * pasted text instead of an uploaded file. Nothing is created here — the
 * client shows the draft for human review and then calls the ordinary
 * create API, so every existing validation and guardrail applies unchanged.
 *
 * Accounts, Contacts, Quotes (header only — no line-item extraction from a
 * single paste, that's Data Workbench's job) and Products.
 */

const DRAFTABLE = {
  accounts: { registryType: "account", featureKey: "accounts" },
  contacts: { registryType: "contact", featureKey: "contacts" },
  quotes: { registryType: "quote", featureKey: "quotations" },
  products: { registryType: "product", featureKey: "products" },
} as const;

type DraftObject = keyof typeof DRAFTABLE;

const MAX_CHARS = 20_000;

type DraftField = { key: string; label: string; required: boolean; options: string[] | null; long: boolean };

// The client renders review forms from these defs -- server truth (the
// tenant's live field config incl. custom fields), never a hardcoded form.
// Reference fields (account_name, contact_name, ...) are resolved by this
// route itself, never shown as a plain text field; quote line columns are
// excluded too -- a single paste extracts a header, not line items.
function toFieldDefs(spec: ObjectSpec): DraftField[] {
  return spec.fields
    .filter((f) => !f.exportOnly && f.type !== "ref" && f.scope !== "line")
    .map((f) => ({
      key: f.key, label: f.label, required: !!f.required,
      options: f.options && f.options.length > 0 ? [...f.options] : null,
      long: f.type === "longtext",
    }));
}

// Name-based ILIKE duplicate search, case-insensitive contains both ways --
// phone/email/GSTIN are encrypted at rest and can't be matched, and account
// names are legitimately non-unique in this product, so this only ever
// warns, never blocks.
async function findAccountDuplicates(supabase: SupabaseClient, tenantId: string, draftName: string | undefined) {
  const dupes: { id: string; name: string; ref: string | null }[] = [];
  const name = draftName?.trim();
  if (!name) return dupes;
  const needle = name.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (needle.length < 3) return dupes;
  const { data } = await supabase
    .from("accounts")
    .select("id, name, ref")
    .eq("tenant_id", tenantId)
    .ilike("name", `%${needle}%`)
    .limit(3);
  dupes.push(...(data ?? []).map((d) => ({ id: d.id, name: d.name, ref: d.ref ?? null })));
  if (dupes.length === 0) {
    // Reverse direction: the DB name may be the shorter one.
    const firstWords = needle.split(" ").slice(0, 2).join(" ");
    if (firstWords.length >= 4) {
      const { data: rev } = await supabase
        .from("accounts")
        .select("id, name, ref")
        .eq("tenant_id", tenantId)
        .ilike("name", `%${firstWords}%`)
        .limit(3);
      dupes.push(...(rev ?? []).map((d) => ({ id: d.id, name: d.name, ref: d.ref ?? null })));
    }
  }
  return dupes;
}

// Draft the ACCOUNT this text is about, whether the object being created is
// the account itself or something that hangs off one (a contact, a quote).
// Returns null when no account could be drafted at all.
async function draftAccountBundle(
  text: string,
  supabase: SupabaseClient,
  tenantId: string,
  salesConfig: SalesConfig
) {
  const fieldConfig = await getEffectiveFieldConfig(supabase, tenantId, "account");
  const spec = buildObjectSpec("accounts", fieldConfig, salesConfig);
  const result = await extractRowsFromDocument(spec, { kind: "text", text }, "pasted text");
  const first = result.rows[0];
  if (!first || !first.values.name?.trim()) return null;
  return {
    values: first.values,
    note: first.note ?? null,
    fields: toFieldDefs(spec),
    possible_duplicates: await findAccountDuplicates(supabase, tenantId, first.values.name),
  };
}

async function draftContactBundle(text: string, supabase: SupabaseClient, tenantId: string, salesConfig: SalesConfig) {
  const fieldConfig = await getEffectiveFieldConfig(supabase, tenantId, "contact");
  const spec = buildObjectSpec("contacts", fieldConfig, salesConfig);
  const result = await extractRowsFromDocument(spec, { kind: "text", text }, "pasted text");
  const first = result.rows[0];
  if (!first || !first.values.name?.trim()) return null;
  return { values: first.values, note: first.note ?? null, fields: toFieldDefs(spec) };
}

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // The whole surface is Nova-only, server-side too -- not just hidden UI.
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const object = body?.object as DraftObject | undefined;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!object || !(object in DRAFTABLE)) {
    return NextResponse.json({ error: `object must be one of: ${Object.keys(DRAFTABLE).join(", ")}` }, { status: 400 });
  }
  if (text.length < 10) {
    return NextResponse.json({ error: "Paste a bit more text — there's nothing to draft from yet." }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: `That's over ${MAX_CHARS.toLocaleString()} characters — paste just the relevant part.` }, { status: 400 });
  }

  const def = DRAFTABLE[object];
  if (!(await tenantHasFeature(supabase, tenantId, def.featureKey))) {
    return NextResponse.json({ error: "That module isn't enabled for your workspace" }, { status: 403 });
  }

  const salesConfig = await getSalesConfig(supabase, tenantId);

  try {
    if (object === "products") {
      // Fully independent object -- no account/contact resolution at all.
      const fieldConfig = await getEffectiveFieldConfig(supabase, tenantId, "product");
      const spec = buildObjectSpec("products", fieldConfig, salesConfig);
      const result = await extractRowsFromDocument(spec, { kind: "text", text }, "pasted text");
      const first = result.rows[0];
      if (!first) {
        return NextResponse.json(
          { error: "Couldn't find a product in that text. Try pasting the part naming the item." },
          { status: 422 }
        );
      }
      return NextResponse.json({
        values: first.values,
        note: first.note ?? null,
        document_notes: result.documentNotes,
        more_found: Math.max(0, result.rows.length - 1),
        fields: toFieldDefs(spec),
      });
    }

    if (object === "accounts") {
      // A pasted message about a company almost always names a PERSON too --
      // draft the contact from the same text in parallel (when the tenant has
      // the module), so account + contact land together. Contact failure
      // never fails the account draft.
      const fieldConfig = await getEffectiveFieldConfig(supabase, tenantId, "account");
      const spec = buildObjectSpec("accounts", fieldConfig, salesConfig);
      const wantContact = await tenantHasFeature(supabase, tenantId, "contacts");

      const [result, contactDraft] = await Promise.all([
        extractRowsFromDocument(spec, { kind: "text", text }, "pasted text"),
        wantContact ? draftContactBundle(text, supabase, tenantId, salesConfig).catch(() => null) : Promise.resolve(null),
      ]);

      const first = result.rows[0];
      if (!first) {
        return NextResponse.json(
          { error: "Couldn't find a record in that text. Try pasting the part that names the company." },
          { status: 422 }
        );
      }

      return NextResponse.json({
        possible_duplicates: await findAccountDuplicates(supabase, tenantId, first.values.name),
        values: first.values,
        note: first.note ?? null,
        document_notes: result.documentNotes,
        more_found: Math.max(0, result.rows.length - 1),
        fields: toFieldDefs(spec),
        contact: contactDraft,
      });
    }

    // contacts / quotes both hang off an account -- draft it as a required
    // companion bundle so the client can offer "attach to an existing
    // account" or "create a new one", never a bare account_id text field.
    const [account, contact] = await Promise.all([
      draftAccountBundle(text, supabase, tenantId, salesConfig),
      (await tenantHasFeature(supabase, tenantId, "contacts")) ? draftContactBundle(text, supabase, tenantId, salesConfig).catch(() => null) : Promise.resolve(null),
    ]);

    if (object === "contacts") {
      // The contact IS the primary object here -- re-extract with the
      // contact spec as top-level `values`/`fields` (the parallel draft
      // above is reused when it matches, to avoid a third call).
      const fieldConfig = await getEffectiveFieldConfig(supabase, tenantId, "contact");
      const spec = buildObjectSpec("contacts", fieldConfig, salesConfig);
      const primary = contact ?? await draftContactBundle(text, supabase, tenantId, salesConfig);
      if (!primary) {
        return NextResponse.json(
          { error: "Couldn't find a person's name in that text." },
          { status: 422 }
        );
      }
      return NextResponse.json({
        values: primary.values,
        note: primary.note,
        fields: toFieldDefs(spec),
        account,
      });
    }

    // quotes -- header-only. `values`/`fields` cover header fields like
    // notes; the account is required, the contact optional.
    const fieldConfig = await getEffectiveFieldConfig(supabase, tenantId, "quote");
    const spec = buildObjectSpec("quotes", fieldConfig, salesConfig);
    const result = await extractRowsFromDocument(spec, { kind: "text", text }, "pasted text");
    const first = result.rows[0] ?? { values: {}, note: undefined };

    if (!account) {
      return NextResponse.json(
        { error: "Couldn't find the account this quote is for. Try pasting the part that names the company." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      values: first.values,
      note: first.note ?? null,
      fields: toFieldDefs(spec),
      account,
      contact,
    });
  } catch (e) {
    if (e instanceof ExtractionError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("Nova draft extraction failed:", e);
    return NextResponse.json({ error: "Drafting failed — try again, or create the record manually." }, { status: 500 });
  }
}
