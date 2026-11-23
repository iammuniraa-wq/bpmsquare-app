import "server-only";
import type { PdfDesign, TenantConfig, TenantEntity } from "@/lib/constants";
import type { Tenant } from "@/lib/tenant";
import { fetchPublic } from "@/lib/net/safeHost";
import { sanitizePdfDesign } from "./design";
import { ARIMO_400_B64, ARIMO_700_B64 } from "./fontData";
import { resolvePdfFrame, revisionText, type FrameFonts, type PdfFrame } from "./frame";

// The server half of the page frame: what resolvePdfFrame cannot do because it is pure -- fetch the logo into the header
// (the browser's header template cannot load a remote image), and hand over the bundled font.

const MAX_LOGO_BYTES = 1_500_000;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const FRAME_FONTS: FrameFonts = {
  regular: `data:font/woff2;base64,${ARIMO_400_B64}`,
  bold: `data:font/woff2;base64,${ARIMO_700_B64}`,
};

/** The workspace logo as a data: URI. A tenant-typed URL, so it goes through fetchPublic (https, public host, redirects checked).
 *  Anything that is not a small raster image, or any failure, returns null: the header then prints the name without a logo. */
export async function logoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:image/")) return url.length <= MAX_LOGO_BYTES * 1.4 ? url : null;
  try {
    const res = await fetchPublic(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!LOGO_TYPES.has(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** The legal entity a document is issued by: the one it names, else the default, else the first, else none. */
export function pickEntity(config: Partial<TenantConfig> | null | undefined, entityId: string | null | undefined): TenantEntity | null {
  const list = config?.entities ?? [];
  return list.find((e) => e.id === entityId) ?? list.find((e) => e.is_default) ?? list[0] ?? null;
}

export function readPdfDesign(config: Partial<TenantConfig> | null | undefined): PdfDesign | null {
  return config?.pdf_design ? sanitizePdfDesign(config.pdf_design) : null;
}

export type DocFrameParams = {
  tenant: Pick<Tenant, "name" | "logo_url" | "company_info" | "config">;
  entityId: string | null | undefined;
  printIds: string[] | null | undefined;
  title: string;
  referenceLabel: string;
  reference: string;
  /** null = no revision text (the workspace does not keep revisions). */
  revisionNo: number | null;
};

/** The frame for one document, or null when the workspace has no design (every renderer then prints as it always did). */
export async function buildDocFrame(p: DocFrameParams): Promise<PdfFrame | null> {
  const design = readPdfDesign(p.tenant.config);
  if (!design) return null;
  const info = p.tenant.company_info ?? {};
  const logo = design.header.logo === "none" ? null : await logoDataUri(info.logo_url || p.tenant.logo_url);
  return resolvePdfFrame({
    design,
    entity: pickEntity(p.tenant.config, p.entityId),
    companyInfo: info,
    tenantName: p.tenant.name,
    logoDataUri: logo,
    printIds: p.printIds ?? [],
    title: p.title,
    referenceLabel: p.referenceLabel,
    reference: p.reference,
    revision: revisionText(p.revisionNo),
    fonts: FRAME_FONTS,
  });
}
