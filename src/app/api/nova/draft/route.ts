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

  try {
    const result = await extractRowsFromDocument(spec, { kind: "text", text }, "pasted text");
    const first = result.rows[0];
    if (!first) {
      return NextResponse.json(
        { error: "Couldn't find a record in that text. Try pasting the part that names the company." },
        { status: 422 }
      );
    }
    // The client renders the review form from these field defs -- server
    // truth (tenant's live field config incl. custom fields), never a
    // hardcoded form.
    const fields = spec.fields
      .filter((f) => !f.exportOnly && f.type !== "ref")
      .map((f) => ({
        key: f.key, label: f.label, required: !!f.required,
        options: f.options && f.options.length > 0 ? [...f.options] : null,
        long: f.type === "longtext",
      }));
    return NextResponse.json({
      values: first.values,
      note: first.note ?? null,
      document_notes: result.documentNotes,
      more_found: Math.max(0, result.rows.length - 1),
      fields,
    });
  } catch (e) {
    if (e instanceof ExtractionError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("Nova draft extraction failed:", e);
    return NextResponse.json({ error: "Drafting failed — try again, or create the record manually." }, { status: 500 });
  }
}
