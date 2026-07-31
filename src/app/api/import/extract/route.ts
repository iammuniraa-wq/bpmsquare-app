import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { REGISTRY_OBJECT_TYPE, buildObjectSpec } from "@/lib/import/registrySchema";
import { dumpDocumentForExtraction, DumpParseError } from "@/lib/import/parseServer";
import { extractRowsFromDocument, ExtractionError } from "@/lib/import/extract";
import type { ImportObjectId } from "@/lib/import/types";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const form = await request.formData();
  const file = form.get("file");
  const objectId = form.get("object");
  if (!(file instanceof File) || typeof objectId !== "string") {
    return NextResponse.json({ error: "Missing file or object" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please split it into files under 15 MB.` },
      { status: 400 }
    );
  }

  const registryType = REGISTRY_OBJECT_TYPE[objectId as ImportObjectId];
  if (!registryType) {
    return NextResponse.json({ error: "This object doesn't support document extraction." }, { status: 400 });
  }

  let documentInput;
  try {
    documentInput = await dumpDocumentForExtraction(file);
  } catch (e) {
    const message = e instanceof DumpParseError ? e.message : "Could not read that file.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const [fieldConfig, salesConfig] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, registryType),
    getSalesConfig(supabase, tenantId),
  ]);
  const spec = buildObjectSpec(objectId as ImportObjectId, fieldConfig, salesConfig);

  try {
    const result = await extractRowsFromDocument(spec, documentInput, file.name);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExtractionError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("Document extraction failed:", e);
    return NextResponse.json({ error: "Extraction failed. Try again, or enter this record manually." }, { status: 500 });
  }
}
