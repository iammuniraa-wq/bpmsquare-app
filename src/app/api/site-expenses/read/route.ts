import { NextResponse, type NextRequest } from "next/server";
import { ReceiptReadError, readReceiptPhoto } from "@/lib/site/readReceipt";
import { evidenceProblem } from "@/lib/site/files";
import { failure, loadCategories, openSiteRequest } from "@/lib/site/server";

// POST /api/site-expenses/read   multipart { photo }  -> 200 { read: { amount, currency, expense_date, vendor_text, vat_amount, invoice_ref,
//   category_name, note } } a PROPOSAL for the "read from photo" fields. Nothing is saved; the person checks every value and the normal validator
//   runs when the expense is submitted. 422 with a plain message when the photo cannot be read (the person types the amount). Needs the Site
//   expenses module. The photo is never stored by this call.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const form = await request.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!photo || typeof photo === "string") return NextResponse.json({ error: "Send a photo" }, { status: 400 });
  const bytes = Buffer.from(await photo.arrayBuffer());
  const problem = evidenceProblem({ name: photo.name, size: photo.size }, bytes, { imageOnly: true });
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  const names = (await loadCategories(gate.req.admin, gate.req.tenantId, { activeOnly: true })).rows.map((c) => c.name);
  try {
    return NextResponse.json({ read: await readReceiptPhoto(bytes, names) });
  } catch (e) {
    if (e instanceof ReceiptReadError) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: "Reading the photo failed. Type the amount." }, { status: 422 });
  }
}
