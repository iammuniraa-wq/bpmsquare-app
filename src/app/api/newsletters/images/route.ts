import { NextResponse, type NextRequest } from "next/server";
import { storeCompanyImage } from "@/lib/companyAssetUpload";
import { errorResponse, newsletterAccess } from "@/lib/newsletter/server";

// POST /api/newsletters/images (multipart "file") -> { path, url }
// Goes through the same validated upload as /api/upload (PNG, JPG or WebP, 2 MB, never
// SVG, extension from the checked MIME type) but is open to anyone who may edit
// newsletters, not only admins: marketing users are not admins. The file lands under
// <tenantId>/assets/, which is the only place the renderer will take an image from.

export async function POST(req: NextRequest) {
  try {
    const ctx = await newsletterAccess("edit");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    const stored = await storeCompanyImage(ctx.admin, ctx.tenantId, file, "assets");
    if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: stored.status });
    return NextResponse.json({ path: stored.path, url: stored.url, bytes: file.size }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
