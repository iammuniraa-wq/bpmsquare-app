import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { extractRowsFromDocument, ExtractionError } from "@/lib/import/extract";

/**
 * Nova pillar 2 — AI record creation. Paste anything (a WhatsApp message,
 * an email, a signature block) and get a DRAFTED record: the same
 * tool-forced extraction engine Data Workbench uses, pointed at a single
 * pasted text instead of an uploaded file. Nothing is created here — the
 * client shows the draft for human review and then calls the ordinary
 * create API, so every existing validation and guardrail applies unchanged.
 *
 * Accounts first (owner-approved MVP); the object map is the extension
 * point for contacts/quotes later.
 */

const DRAFTABLE = {
  accounts: { registryType: "account", featureKey: "accounts" },
} as const;

const MAX_CHARS = 20_000;

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
  const object = body?.object as keyof typeof DRAFTABLE | undefined;
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

  const [fieldConfig, salesConfig] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, def.registryType),
    getSalesConfig(supabase, tenantId),
  ]);
  const spec = buildObjectSpec(object, fieldConfig, salesConfig);

  // The client renders review forms from these defs -- server truth (the
  // tenant's live field config incl. custom fields), never a hardcoded form.
  const toFieldDefs = (s: typeof spec) => s.fields
    .filter((f) => !f.exportOnly && f.type !== "ref")
    .map((f) => ({
      key: f.key, label: f.label, required: !!f.required,
      options: f.options && f.options.length > 0 ? [...f.options] : null,
      long: f.type === "longtext",
    }));

  try {
    // A pasted message about a company almost always names a PERSON too --
    // draft the contact from the same text in parallel (when the tenant has
    // the module), so account + contact land together. Contact failure never
    // fails the account draft.
    const wantContact = object === "accounts" && (await tenantHasFeature(supabase, tenantId, "contacts"));
    const contactSpecPromise = wantContact
      ? getEffectiveFieldConfig(supabase, tenantId, "contact").then((fc) => buildObjectSpec("contacts", fc, salesConfig))
      : null;

    const [result, contactDraft] = await Promise.all([
      extractRowsFromDocument(spec, { kind: "text", text }, "pasted text"),
      contactSpecPromise
        ? contactSpecPromise.then(async (cSpec) => {
            const r = await extractRowsFromDocument(cSpec, { kind: "text", text }, "pasted text");
            const c = r.rows[0];
            if (!c || !c.values.name?.trim()) return null;
            return { values: c.values, note: c.note ?? null, fields: toFieldDefs(cSpec) };
          }).catch(() => null)
        : Promise.resolve(null),
    ]);

    const first = result.rows[0];
    if (!first) {
      return NextResponse.json(
        { error: "Couldn't find a record in that text. Try pasting the part that names the company." },
        { status: 422 }
      );
    }

    // Duplicate check, at DRAFT time where a human can still decide:
    // name-based (phone/email/GSTIN are encrypted at rest and cannot be
    // matched), case-insensitive contains both ways, so "Deccan Polymers"
    // finds "Deccan Polymers Pvt Ltd" and vice versa. Warns, never blocks --
    // account names are legitimately non-unique in this product.
    let possibleDuplicates: { id: string; name: string; ref: string | null }[] = [];
    const draftName = first.values.name?.trim();
    if (draftName) {
      const needle = draftName.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
      if (needle.length >= 3) {
        const { data: dupes } = await supabase
          .from("accounts")
          .select("id, name, ref")
          .eq("tenant_id", tenantId)
          .ilike("name", `%${needle}%`)
          .limit(3);
        possibleDuplicates = (dupes ?? []).map((d) => ({ id: d.id, name: d.name, ref: d.ref ?? null }));
        if (possibleDuplicates.length === 0) {
          // Reverse direction: the DB name may be the shorter one.
          const firstWords = needle.split(" ").slice(0, 2).join(" ");
          if (firstWords.length >= 4) {
            const { data: rev } = await supabase
              .from("accounts")
              .select("id, name, ref")
              .eq("tenant_id", tenantId)
              .ilike("name", `%${firstWords}%`)
              .limit(3);
            possibleDuplicates = (rev ?? []).map((d) => ({ id: d.id, name: d.name, ref: d.ref ?? null }));
          }
        }
      }
    }

    return NextResponse.json({
      possible_duplicates: possibleDuplicates,
      values: first.values,
      note: first.note ?? null,
      document_notes: result.documentNotes,
      more_found: Math.max(0, result.rows.length - 1),
      fields: toFieldDefs(spec),
      contact: contactDraft,
    });
  } catch (e) {
    if (e instanceof ExtractionError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("Nova draft extraction failed:", e);
    return NextResponse.json({ error: "Drafting failed — try again, or create the record manually." }, { status: 500 });
  }
}
